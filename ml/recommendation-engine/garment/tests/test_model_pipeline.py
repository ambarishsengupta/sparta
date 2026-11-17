"""WO-0031 tests: network shape and weight count, split and training rules, export check, evaluation on a tiny synthetic
IDX pair, model card generation, and the source scans (CSV never read, test split never trained on)."""
import hashlib
import json
import re
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

GARMENT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GARMENT))

import numpy as np  # noqa: E402
import torch  # noqa: E402

import evaluate as ev  # noqa: E402
import export_onnx as ex  # noqa: E402
import idx  # noqa: E402
import model as M  # noqa: E402
import preprocess as pp  # noqa: E402
import train as T  # noqa: E402

NAMES = [n for pair in idx.FILES.values() for n in pair]
SHA_LINE = r"\*\*ONNX SHA-256:\*\* `([0-9a-f]{64})`"

def write_idx(folder):
    """A tiny synthetic IDX pair (2 train, 2 test pictures) in `folder`, and a README listing the real hashes of those files."""
    for split, v in (("train", 0), ("test", 1)):
        (folder / idx.FILES[split][0]).write_bytes(struct.pack(">IIII", idx.IMAGES_MAGIC, 2, 28, 28) + bytes([v]) * 1568)
        (folder / idx.FILES[split][1]).write_bytes(struct.pack(">II", idx.LABELS_MAGIC, 2) + bytes([v, v + 2]))
    (folder / "README.md").write_text("\n".join(f"| `mnist/{n}` | 2 | `{hashlib.sha256((folder / n).read_bytes()).hexdigest()}` |" for n in NAMES), encoding="utf-8")

class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)
        torch.manual_seed(0)
        self.net = M.GarmentCNN().eval()

class NetworkTests(Base):
    def test_weight_count_and_blocks_are_the_documented_ones(self):
        self.assertEqual(M.weight_count(self.net), 160 + 4640 + 18496 + 2080 + 330)   # 25,706: "about 26,000" in LLD 7.7
        convs = [m for m in self.net.features if isinstance(m, torch.nn.Conv2d)]
        self.assertEqual([(c.in_channels, c.out_channels, c.kernel_size) for c in convs], [(1, 16, (3, 3)), (16, 32, (3, 3)), (32, 64, (3, 3))])
        self.assertEqual(sum(isinstance(m, torch.nn.MaxPool2d) for m in self.net.features), 2)       # after the first two blocks only
        self.assertEqual((self.net.dense[0].out_features, self.net.out.out_features), (32, 10))

    def test_two_outputs_ten_scores_and_thirty_two_numbers(self):
        scores, shape = M.ExportCNN(self.net)(torch.rand(5, 1, 28, 28))
        self.assertEqual((tuple(scores.shape), tuple(shape.shape), M.OUTPUT_NAMES), ((5, 10), (5, 32), ["scores", "shape"]))
        np.testing.assert_allclose(scores.sum(1).detach().numpy(), 1.0, rtol=1e-5)                 # softmax scores
        self.assertGreaterEqual(float(shape.detach().min()), 0.0)                                  # ReLU shape numbers

class TrainingRuleTests(Base):
    def test_split_is_54000_6000_stratified_seeded_and_disjoint(self):
        labels = np.repeat(np.arange(10), 6000)
        tr, va = T.stratified_split(labels, 600, seed=1)
        self.assertEqual((len(tr), len(va), len(set(tr) | set(va))), (54000, 6000, 60000))
        self.assertEqual(np.bincount(labels[va]).tolist(), [600] * 10)
        np.testing.assert_array_equal(va, T.stratified_split(labels, 600, seed=1)[1])
        self.assertFalse(np.array_equal(va, T.stratified_split(labels, 600, seed=2)[1]))

    def test_training_data_comes_from_the_train_split_only(self):
        seen = []
        def fake(root, split):
            seen.append(split)
            return np.zeros((40, 28, 28), np.uint8), np.repeat(np.arange(10), 4).astype(np.uint8)
        with mock.patch.object(idx, "load_split", fake):
            x_tr, _, x_va, _ = T.load_training_data(self.dir, 1, val_per_class=1)
        self.assertEqual((seen, len(x_tr), len(x_va)), (["train"], 30, 10))

    def test_augment_keeps_shape_and_range_and_is_seeded(self):
        x = torch.rand(32, 1, 28, 28)
        a, b = T.augment(x, torch.Generator().manual_seed(3)), T.augment(x, torch.Generator().manual_seed(3))
        self.assertTrue(tuple(a.shape) == (32, 1, 28, 28) and 0 <= float(a.min()) and float(a.max()) <= 1 and torch.equal(a, b) and not torch.equal(a, x))

    def test_train_uses_adam_and_label_smoothing_keeps_best_weights_and_respects_the_time_box(self):
        x, y = torch.rand(120, 1, 28, 28, generator=torch.Generator().manual_seed(0)), torch.arange(120) % 10
        run = lambda **kw: T.train(x, y, x[:40], y[:40], seed=1, log=lambda s: None, **kw)
        with mock.patch.object(T.nn, "CrossEntropyLoss", wraps=torch.nn.CrossEntropyLoss) as loss, mock.patch.object(torch.optim, "Adam", wraps=torch.optim.Adam) as adam:
            net, summary = run(max_epochs=3, budget_s=1e9)
        self.assertEqual((loss.call_args.kwargs, adam.call_count), ({"label_smoothing": 0.1}, 1))   # LLD 7.7
        self.assertEqual((summary["epochs_run"], summary["stopped_by"]), (3, "max_epochs"))
        self.assertAlmostEqual(T.accuracy(net, x[:40], y[:40]), summary["best_val_accuracy"], places=4)   # best epoch's weights restored
        self.assertEqual([run(max_epochs=3, budget_s=0)[1][k] for k in ("epochs_run", "stopped_by")], [1, "time_box"])

class SourceScanTests(unittest.TestCase):
    def source(self, name):   # code and comments, without the module docstring
        return re.sub(r'""".*?"""', "", (GARMENT / name).read_text(encoding="utf-8"), count=1, flags=re.S)

    def test_csv_files_are_never_read(self):
        for name in ["model.py", "train.py", "export_onnx.py", "evaluate.py"]:
            self.assertIsNone(re.search(r"\.csv|read_csv|pandas|loadtxt|genfromtxt|fashion-mnist_|import csv", self.source(name), re.I), name)

    def test_training_never_touches_the_test_split(self):
        self.assertIsNone(re.search(r"t10k|[\"']test[\"']|test_images|test_labels", self.source("train.py")))
        self.assertIn('"train"', self.source("train.py"))

class ExportAndEvaluateTests(Base):
    def test_onnx_matches_pytorch_and_keeps_output_order(self):
        path = ex.export(self.net, self.dir / "m.onnx")
        x = np.random.RandomState(0).rand(100, 1, 28, 28).astype(np.float32)
        self.assertLessEqual(ex.max_difference(self.net, path, x), ex.TOLERANCE)
        sess = ex.session(path)
        scores, shape = sess.run(None, {"input": x[:3]})
        self.assertEqual(([o.name for o in sess.get_outputs()], scores.shape, shape.shape), (["scores", "shape"], (3, 10), (3, 32)))
        self.assertLess(path.stat().st_size, ex.MAX_BYTES)

    def test_committed_onnx_file(self):
        if not ex.ONNX_PATH.is_file():
            self.skipTest(f"{ex.ONNX_PATH} is absent: run export_onnx.py first")
        scores, shape = ex.session(ex.ONNX_PATH).run(None, {"input": np.zeros((2, 1, 28, 28), np.float32)})
        self.assertEqual((ex.ONNX_PATH.stat().st_size < 1_000_000, scores.shape, shape.shape), (True, (2, 10), (2, 32)))

    def test_evaluate_on_a_tiny_synthetic_idx_pair(self):
        images = np.random.RandomState(1).randint(0, 256, (30, 28, 28)).astype(np.uint8)
        labels = (np.arange(30) % 10).astype(np.uint8)
        r = ev.evaluate(ex.export(self.net, self.dir / "m.onnx"), images, labels, batch=7)
        pred = self.net(torch.from_numpy(images[:, None].astype(np.float32) / 255))[0].argmax(1).numpy()
        want = np.zeros((10, 10), int)
        np.add.at(want, (labels, pred), 1)
        self.assertEqual((r["confusion"], r["count"], [p["total"] for p in r["per_class"]]), (want.tolist(), 30, [3] * 10))
        self.assertAlmostEqual(r["accuracy"], float((pred == labels).mean()))
        self.assertEqual(sum(p["correct"] for p in r["per_class"]), round(r["accuracy"] * 30))
        fed = []                                                                                     # the model must be fed exactly the shared preprocessing's output
        fake = mock.Mock(run=lambda names, feed: fed.append(feed["input"]) or [np.zeros((len(feed["input"]), 10), np.float32)])
        with mock.patch.object(ev, "session", return_value=fake):
            ev.evaluate("unused.onnx", images, labels, batch=7)
        np.testing.assert_array_equal(np.concatenate(fed), pp.normalise(images))
        write_idx(self.dir)                                                                          # and through the IDX reader
        self.assertEqual(ev.evaluate(self.dir / "m.onnx", *idx.load_split(self.dir, "test"))["count"], 2)

class ModelCardTests(Base):
    def facts(self, accuracy=0.9):
        per_class = [{"class": c, "name": ev.CLASS_NAMES[c], "correct": 90, "total": 100, "accuracy": 0.9} for c in range(10)]
        return {"train": {"settings": T.SETTINGS, "weights": 25706, "train_size": 54000, "val_size": 6000, "seed": 7, "budget_minutes": 25, "epochs_run": 12,
                          "best_epoch": 9, "best_val_accuracy": 0.9, "stopped_by": "early_stopping", "train_seconds": 100, "threads": 8},
                "export": {"bytes": 105000, "opset": 17, "check_pictures": 100, "max_abs_difference": 1e-7, "tolerance": 1e-4},
                "evaluation": {"count": 1000, "accuracy": accuracy, "per_class": per_class, "confusion": np.eye(10, dtype=int).tolist()},
                "data": {n: "ab" * 32 for n in NAMES}, "onnx_sha256": "cd" * 32, "libs": {"torch": "0"}}

    def test_card_has_the_required_sections_and_the_honest_status(self):
        card = ev.render_card(self.facts())
        for text in ["NOT done", "`GARMENT_GUESS_ENABLED` must stay false", "0.6", "Xiao, H., Rasul, K. and Vollgraf, R. (2017)", "MIT License", "Zalando SE",
                     "54,000 training and 6,000 validation", "seed 7", "Overall accuracy: 0.9000", "Confusion matrix", "T-shirt/top", "phone photos", "White and very light"]:
            self.assertIn(text, card)
        self.assertEqual((re.findall(SHA_LINE, card), card.count("`" + "ab" * 32 + "`")), (["cd" * 32], 4))     # ONNX hash, four IDX hashes
        self.assertNotIn("below the 0.85 floor", card)
        self.assertIn("below the 0.85 floor", ev.render_card(self.facts(0.8)))

    def test_data_hashes_must_equal_the_readme(self):
        write_idx(self.dir)
        self.assertEqual(sorted(ev.data_hashes(self.dir, self.dir / "README.md")), sorted(NAMES))
        (self.dir / NAMES[1]).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, re.escape(NAMES[1])):
            ev.data_hashes(self.dir, self.dir / "README.md")

    def test_built_card_carries_the_real_onnx_hash_and_refuses_a_stale_export(self):
        onnx_path, f = ex.export(self.net, self.dir / "m.onnx"), self.facts()
        real = hashlib.sha256(onnx_path.read_bytes()).hexdigest()
        write_idx(self.dir)
        save = lambda sha: [(self.dir / n).write_text(json.dumps(b), encoding="utf-8") for n, b in
                            [("train_summary.json", f["train"]), ("evaluate_summary.json", f["evaluation"]), ("export_summary.json", {**f["export"], "sha256": sha})]]
        save(real)
        card = ev.build_card(self.dir, onnx_path, self.dir, self.dir / "card.md", self.dir / "README.md")
        self.assertEqual((re.findall(SHA_LINE, card), (self.dir / "card.md").read_text(encoding="utf-8")), ([real], card))
        save("00" * 32)
        with self.assertRaisesRegex(ValueError, "different ONNX file"):
            ev.build_card(self.dir, onnx_path, self.dir, self.dir / "card2.md", self.dir / "README.md")

if __name__ == "__main__":
    unittest.main()
