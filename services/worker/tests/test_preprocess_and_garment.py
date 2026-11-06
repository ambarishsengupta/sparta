import hashlib
import importlib.util
import json
import re
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from conftest import REPO, WORKER_DIR
from worker.garment import preprocess as worker_pre
from worker.garment.model import DEFAULT_MODEL, GarmentModel

ML = REPO / "ml" / "recommendation-engine" / "garment"
FIX = Path(__file__).resolve().parent / "fixtures"
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()

GOLDEN = {"fmnist_c0_0": "2a2b202648e81a27", "fmnist_c1_0": "7f789cfb3b9f87a3", "fmnist_c2_0": "3cdfee2d286999df", "fmnist_c3_0": "8366e5cb528e77f1",
          "fmnist_c4_0": "0904c87988fd2375", "fmnist_c5_0": "beaf47613bd5dba7", "fmnist_c6_0": "c2aa8f13b2b738e1", "fmnist_c7_0": "ff5a5eb362d16f2e",
          "fmnist_c8_0": "cae385be1b61ee66", "fmnist_c9_0": "2562b15cd9e5edcb"}


def fixtures():
    return sorted(FIX.glob("fmnist_c*_*.png"))


def test_preprocess_copy_is_byte_identical_to_the_ml_original():
    assert sha(worker_pre.__file__) == sha(ML / "preprocess.py")        # LLD 7.7: one implementation, copied


def test_class_map_copy_is_byte_identical():
    assert sha(WORKER_DIR / "worker" / "garment" / "class_map.json") == sha(ML / "class_map.json")


def test_both_implementations_give_identical_arrays_on_every_fixture():
    spec = importlib.util.spec_from_file_location("ml_preprocess", ML / "preprocess.py")
    ml = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ml)
    assert len(fixtures()) == 20
    for f in fixtures():
        assert np.array_equal(ml.preprocess(Image.open(f)), worker_pre.preprocess(Image.open(f))), f.name


def test_golden_preprocess_outputs_on_ten_fixture_cutouts():
    for name, want in GOLDEN.items():
        got = hashlib.sha256(worker_pre.preprocess(Image.open(FIX / f"{name}.png")).tobytes()).hexdigest()[:16]
        assert got == want, name


def test_preprocess_shape_dtype_range_and_empty_cutout():
    x = worker_pre.preprocess(Image.open(FIX / "fmnist_c1_0.png"))
    assert x.shape == (1, 1, 28, 28) and x.dtype == np.float32 and 0.0 <= x.min() and x.max() <= 1.0 and x.max() > 0.5
    with pytest.raises(ValueError):
        worker_pre.preprocess(Image.new("RGBA", (10, 10), (0, 0, 0, 0)))


def test_the_committed_onnx_file_matches_the_model_card_hash():
    card = (ML / "model_card.md").read_text()
    want = re.search(r"\*\*ONNX SHA-256:\*\* `([0-9a-f]{64})`", card).group(1)
    assert sha(DEFAULT_MODEL) == want and DEFAULT_MODEL.stat().st_size < 1_000_000


@pytest.fixture(scope="module")
def model():
    return GarmentModel(min_confidence=0.6)


def test_accuracy_on_20_fashion_mnist_cutouts_is_at_least_15(model):
    right, wrong = 0, []
    for f in fixtures():
        want = int(f.stem.split("_")[1][1:])
        got = model.infer(Image.open(f))["class"]
        right += got == want
        if got != want:
            wrong.append((f.stem, got))
    print(f"garment v1 sanity: {right}/20 correct; misses: {wrong}")      # honest number, shown with -s and recorded in the notes
    assert right >= 15


def test_result_schema_is_version_1(model):
    g = model.infer(Image.open(FIX / "fmnist_c7_0.png"))
    assert set(g) == {"model_version", "class", "p", "category", "sub_type", "embedding"}
    assert g["model_version"] == "garment-cnn-v1" and 0 <= g["class"] <= 9 and 0.0 <= g["p"] <= 1.0
    assert len(g["embedding"]) == 32 and all(isinstance(v, float) for v in g["embedding"])
    json.dumps(g)                                                         # storable in app.jobs.result


def test_a_confident_sneaker_gets_footwear_sneakers(model):
    g = model.infer(Image.open(FIX / "fmnist_c7_0.png"))
    assert g["class"] == 7 and g["p"] >= 0.6 and (g["category"], g["sub_type"]) == ("Footwear", "Sneakers")


def test_the_threshold_decides_exactly_at_p(model):
    img = Image.open(FIX / "fmnist_c2_0.png")
    g = model.infer(img)
    assert len(g["embedding"]) == 32
    at = GarmentModel(min_confidence=g["p"]).infer(img)               # p >= threshold counts
    assert at["category"] is not None or g["class"] == 3
    above = GarmentModel(min_confidence=min(1.0, g["p"] + 0.00001)).infer(img)
    assert g["p"] >= 1.0 or (above["category"] is None and above["sub_type"] is None and len(above["embedding"]) == 32)


def test_dress_never_maps_to_a_category():
    m = GarmentModel(min_confidence=0.01)                              # even when "confident", Dress (class 3) has no mapping (FDD 14.3)
    seen = 0
    for f in FIX.glob("fmnist_c3_*.png"):
        g = m.infer(Image.open(f))
        if g["class"] == 3:
            seen += 1
            assert g["category"] is None and g["sub_type"] is None and g["p"] >= 0.01
    assert seen >= 1


def test_class_map_has_ten_classes_and_only_dress_is_unmapped():
    cm = json.loads((WORKER_DIR / "worker" / "garment" / "class_map.json").read_text())
    assert sorted(cm, key=int) == [str(i) for i in range(10)]
    assert [k for k, v in cm.items() if v["category"] is None] == ["3"]


def test_every_mapped_value_exists_in_the_taxonomy():
    text = (REPO / "packages" / "taxonomy" / "src" / "taxonomy.json").read_text()
    cm = json.loads((WORKER_DIR / "worker" / "garment" / "class_map.json").read_text())
    for v in cm.values():
        if v["category"]:
            assert f'"{v["category"]}"' in text and f'"{v["sub_type"]}"' in text


def test_a_blank_picture_gives_an_error_not_a_guess(model):
    with pytest.raises(ValueError):
        model.infer(Image.new("RGBA", (50, 50), (0, 0, 0, 0)))


class FixedSession:
    def __init__(self, scores):
        self.scores = scores

    def get_inputs(self):
        return [type("I", (), {"name": "input"})()]

    def run(self, _, feed):
        return [self.scores[None, :], np.zeros((1, 32), dtype=np.float32)]


def test_confidence_boundary_is_inclusive_with_a_stubbed_session():
    scores = np.full(10, 0.04, dtype=np.float32)
    scores[7] = np.float32(0.64)
    m = GarmentModel(min_confidence=float(scores[7]))
    m._session = FixedSession(scores)
    g = m.infer(Image.open(FIX / "fmnist_c7_0.png"))
    assert g["class"] == 7 and (g["category"], g["sub_type"]) == ("Footwear", "Sneakers")          # p equal to the threshold counts
    m.min_confidence = float(np.nextafter(scores[7], np.float32(1.0)))
    assert m.infer(Image.open(FIX / "fmnist_c7_0.png"))["category"] is None


def test_a_malformed_model_output_is_an_error():
    m = GarmentModel()
    m._session = type("S", (), {"get_inputs": lambda s: [type("I", (), {"name": "input"})()],
                                "run": lambda s, a, b: [np.zeros((1, 9), dtype=np.float32), np.zeros((1, 32), dtype=np.float32)]})()
    with pytest.raises(ValueError):
        m.infer(Image.open(FIX / "fmnist_c7_0.png"))
