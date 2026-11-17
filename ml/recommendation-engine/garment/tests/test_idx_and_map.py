"""IDX reader (magic numbers, counts, shapes), the data-root setting, a real-IDX smoke test and class_map.json."""
import hashlib
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

GARMENT = Path(__file__).resolve().parents[1]
REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(GARMENT))

import numpy as np  # noqa: E402

import idx  # noqa: E402

TEST_LABELS_SHA256 = "0402a96d92fd2663957122ceb108a494c5af83dab82d92729df917d7dec38c34"   # data/recommendation-engine/README.md

def blob(magic, dims, payload):
    return struct.pack(">" + "I" * (1 + len(dims)), magic, *dims) + payload

class IdxReaderTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def write(self, name, data):
        (self.dir / name).write_bytes(data)
        return self.dir / name

    def refuses(self, reader, regex, data, **kw):
        with self.assertRaisesRegex(idx.IdxError, regex):
            reader(self.write("f", data), **kw)

    def test_images_and_labels_round_trip(self):
        pixels = (np.arange(3 * 28 * 28) % 256).astype(np.uint8)
        images = idx.read_images(self.write("img", blob(idx.IMAGES_MAGIC, (3, 28, 28), pixels.tobytes())), count=3)
        np.testing.assert_array_equal(images.reshape(-1), pixels)
        self.assertEqual(images.shape, (3, 28, 28))
        np.testing.assert_array_equal(idx.read_labels(self.write("lab", blob(idx.LABELS_MAGIC, (4,), bytes([0, 9, 3, 3]))), count=4), [0, 9, 3, 3])

    def test_bad_magic_is_refused(self):
        self.refuses(idx.read_images, "bad magic", blob(idx.LABELS_MAGIC, (1, 28, 28), bytes(784)))   # label magic on a picture file
        self.refuses(idx.read_labels, "bad magic", blob(idx.IMAGES_MAGIC, (2,), bytes(2)))            # picture magic on a label file

    def test_item_count_and_label_range_are_checked(self):
        self.refuses(idx.read_labels, "expected 6", blob(idx.LABELS_MAGIC, (5,), bytes(5)), count=6)
        self.refuses(idx.read_labels, "payload", blob(idx.LABELS_MAGIC, (5,), bytes(4)))             # header says 5, 4 bytes follow
        self.refuses(idx.read_labels, "payload", blob(idx.LABELS_MAGIC, (5,), bytes(6)))             # header says 5, 6 bytes follow
        self.refuses(idx.read_labels, "label 10", blob(idx.LABELS_MAGIC, (2,), bytes([1, 10])))      # outside 0 to 9

    def test_picture_shape_and_truncation_are_checked(self):
        self.refuses(idx.read_images, "27 by 28", blob(idx.IMAGES_MAGIC, (1, 27, 28), bytes(27 * 28)))
        self.refuses(idx.read_images, "truncated header", b"\x00\x00\x08")

    def test_load_split_needs_equal_counts(self):
        self.write("t10k-images-idx3-ubyte", blob(idx.IMAGES_MAGIC, (2, 28, 28), bytes(2 * 784)))
        self.write("t10k-labels-idx1-ubyte", blob(idx.LABELS_MAGIC, (3,), bytes(3)))
        with self.assertRaisesRegex(idx.IdxError, "expected 2"):
            idx.load_split(self.dir, "test")
        self.write("t10k-labels-idx1-ubyte", blob(idx.LABELS_MAGIC, (2,), bytes([7, 8])))
        images, labels = idx.load_split(self.dir, "test")
        self.assertEqual((images.shape, labels.tolist()), ((2, 28, 28), [7, 8]))

    def test_data_root_setting(self):
        env = self.write("local.env", b"# comment\nOTHER=1\nSPARTA_DATA_ROOT_MNIST=/data/with space/mnist\n")
        self.assertEqual(idx.data_root(env_file=env, environ={}), Path("/data/with space/mnist"))
        self.assertEqual(idx.data_root(env_file=env, environ={idx.DATA_ROOT_KEY: "/other"}), Path("/other"))
        with self.assertRaises(SystemExit):                                                          # unset
            idx.data_root(env_file=self.write("empty.env", b"OTHER=1\n"), environ={})
        with self.assertRaises(SystemExit):                                                          # relative
            idx.data_root(env_file=env, environ={idx.DATA_ROOT_KEY: "relative/path"})

class RealIdxSmokeTest(unittest.TestCase):
    def test_real_test_labels_are_balanced(self):
        try:
            labels_path = idx.data_root() / idx.FILES["test"][1]
        except SystemExit as e:
            self.skipTest(f"Fashion-MNIST folder not configured ({e}); real-IDX smoke test not run")
        if not labels_path.is_file():
            self.skipTest(f"Fashion-MNIST data folder unavailable ({labels_path} missing); real-IDX smoke test not run")
        self.assertEqual(hashlib.sha256(labels_path.read_bytes()).hexdigest(), TEST_LABELS_SHA256)
        labels = idx.read_labels(labels_path, count=10000)
        self.assertEqual(np.bincount(labels, minlength=10).tolist(), [1000] * 10)
        self.assertEqual(idx.read_images(labels_path.parent / idx.FILES["test"][0], count=10000).shape, (10000, 28, 28))

class ClassMapTests(unittest.TestCase):
    NAMES = ["T-shirt/top", "Trouser", "Pullover", "Dress", "Coat", "Sandal", "Shirt", "Sneaker", "Bag", "Ankle boot"]
    TABLE = {0: ("Tops", "T-shirt"), 1: ("Bottoms", "Trousers"), 2: ("Tops", "Sweater"), 3: (None, None),
             4: ("Outerwear", "Coat"), 5: ("Footwear", "Sandals"), 6: ("Tops", "Shirt"), 7: ("Footwear", "Sneakers"),
             8: ("Accessories", "Bag"), 9: ("Footwear", "Boots")}                                    # FDD 14.3, first table

    @classmethod
    def setUpClass(cls):
        cls.cmap = json.loads((GARMENT / "class_map.json").read_text(encoding="utf-8"))
        taxonomy = json.loads((REPO / "packages/taxonomy/src/taxonomy.json").read_text(encoding="utf-8"))
        cls.subtypes = {c["name"]: c["subTypes"] for c in taxonomy["categories"]}

    def test_ids_zero_to_nine_with_fashion_mnist_names(self):
        self.assertEqual(list(self.cmap), [str(i) for i in range(10)])
        self.assertEqual([self.cmap[str(i)]["name"] for i in range(10)], self.NAMES)
        self.assertTrue(all(sorted(e) == ["category", "name", "sub_type"] for e in self.cmap.values()))

    def test_values_exist_in_taxonomy(self):
        for i, e in self.cmap.items():
            if e["category"] is not None:
                self.assertIn(e["category"], self.subtypes, f"class {i}")
                self.assertIn(e["sub_type"], self.subtypes[e["category"]], f"class {i}")

    def test_dress_gives_no_suggestion_and_the_rest_match_fdd_table(self):
        self.assertEqual(self.cmap["3"], {"name": "Dress", "category": None, "sub_type": None})
        for i, pair in self.TABLE.items():
            self.assertEqual((self.cmap[str(i)]["category"], self.cmap[str(i)]["sub_type"]), pair)
