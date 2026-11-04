"""Preprocessing golden tests on synthetic RGBA cut-outs (built here: no H&M, no team photos).

`reference` redoes the glossary steps with exact fractions, pixel by pixel; only the Lanczos resize calls PIL,
and `lanczos_numpy` checks that filter separately in float.
"""
import sys
import unittest
from fractions import Fraction as F
from math import floor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import preprocess as pp  # noqa: E402

def rnd(x):
    return int(floor(x + F(1, 2)))                                                       # round half up

def reference(rgba, resize=None):
    h, w, _ = rgba.shape
    inside = [(y, x) for y in range(h) for x in range(w) if F(int(rgba[y, x, 3]), 255) > F(1, 10)]
    y0, y1, x0, x1 = min(p[0] for p in inside), max(p[0] for p in inside), min(p[1] for p in inside), max(p[1] for p in inside)
    grey = np.zeros((y1 - y0 + 1, x1 - x0 + 1), dtype=np.uint8)                          # step 1: crop (above)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            a = F(int(rgba[y, x, 3]), 255)
            r, g, b = (rnd(int(c) * a + 255 * (1 - a)) for c in rgba[y, x, :3])          # step 2: composite on white
            grey[y - y0, x - x0] = 255 - rnd(F(299, 1000) * r + F(587, 1000) * g + F(114, 1000) * b)   # steps 3 and 4
    scale = F(28, max(grey.shape))
    nh, nw = (max(1, rnd(n * scale)) for n in grey.shape)                                # step 5
    small = resize(grey, nh, nw) if resize else np.asarray(Image.fromarray(grey, "L").resize((nw, nh), Image.LANCZOS))
    canvas = np.zeros((28, 28), dtype=np.uint8)
    canvas[(28 - nh) // 2:(28 - nh) // 2 + nh, (28 - nw) // 2:(28 - nw) // 2 + nw] = small
    return (canvas.astype(np.float64) / 255).astype(np.float32).reshape(1, 1, 28, 28)   # step 6

def lanczos_numpy(grey, nh, nw):
    def weights(n_in, n_out):
        scale, m = n_in / n_out, np.zeros((n_out, n_in))
        for i in range(n_out):
            x = (np.arange(n_in) + 0.5 - (i + 0.5) * scale) / max(scale, 1.0)
            m[i] = np.where(np.abs(x) < 3, np.sinc(x) * np.sinc(x / 3), 0.0)
            m[i] /= m[i].sum()
        return m
    out = weights(grey.shape[0], nh) @ grey.astype(np.float64) @ weights(grey.shape[1], nw).T
    return np.clip(np.floor(out + 0.5), 0, 255).astype(np.uint8)

def blank(h, w):
    return np.zeros((h, w, 4), dtype=np.uint8)

def pixel(r, g, b, a):
    return np.array([[[r, g, b, a]]], dtype=np.uint8)

def fixtures():
    rng = np.random.default_rng(20261104)
    fx = {name: blank(*size) for name, size in (("red square, off-centre", (40, 40)), ("wide blue band", (30, 50)),
          ("tall green gradient", (60, 20)), ("13 wide, 28 tall (odd gap)", (40, 40)), ("soft alpha ramp", (32, 32)),
          ("alpha 25 ring around alpha 26", (20, 20)), ("white garment", (24, 24)))}
    fx["red square, off-centre"][5:25, 8:28] = (200, 30, 30, 255)
    fx["wide blue band"][10:20, 5:35] = (10, 20, 120, 255)
    for y in range(5, 45):
        fx["tall green gradient"][y, 4:14] = (0, 60 + 3 * y, 40, 255)
    fx["13 wide, 28 tall (odd gap)"][3:31, 10:23] = (128, 128, 128, 255)
    fx["soft alpha ramp"][4:28, 4:28, :3] = (180, 90, 40)
    fx["soft alpha ramp"][4:28, 4:28, 3] = np.linspace(26, 255, 24).astype(np.uint8)
    fx["alpha 25 ring around alpha 26"][2:18, 2:18] = (255, 0, 0, 25)
    fx["alpha 25 ring around alpha 26"][4:16, 4:12] = (0, 0, 255, 26)
    fx["white garment"][2:22, 5:19] = 255
    fx["tiny 5x7 upscaled"] = rng.integers(0, 256, (5, 7, 4)).astype(np.uint8)
    fx["tiny 5x7 upscaled"][:, :, 3] = 255
    fx["random noise with random alpha"] = rng.integers(0, 256, (24, 31, 4)).astype(np.uint8)
    fx["opaque 28x28 (no resize)"] = rng.integers(0, 256, (28, 28, 4)).astype(np.uint8)
    fx["opaque 28x28 (no resize)"][:, :, 3] = 255
    return fx

class PreprocessTests(unittest.TestCase):
    def test_ten_golden_fixtures_match_the_reference_exactly(self):
        self.assertEqual(len(fixtures()), 10)
        for name, rgba in fixtures().items():
            with self.subTest(name):
                np.testing.assert_array_equal(pp.preprocess(rgba), reference(rgba))

    def test_output_contract(self):
        for name, rgba in fixtures().items():
            out = pp.preprocess(rgba)
            self.assertEqual((out.shape, out.dtype), ((1, 1, 28, 28), np.float32), name)
            self.assertTrue(0.0 <= out.min() and out.max() <= 1.0, name)

    def test_deterministic_pil_input_and_input_not_modified(self):
        rgba = fixtures()["random noise with random alpha"]
        before = rgba.copy()
        np.testing.assert_array_equal(pp.preprocess(rgba), pp.preprocess(rgba))
        np.testing.assert_array_equal(rgba, before)
        np.testing.assert_array_equal(pp.preprocess(Image.fromarray(rgba, "RGBA")), pp.preprocess(rgba))   # a PIL image is accepted too

    def test_alpha_threshold_is_ten_percent(self):
        block = blank(12, 12); block[3:9, 3:9] = (0, 0, 0, 255)
        for alpha, same_as_block in ((25, True), (26, False), (100, False)):              # 25/255 is below 10%, 26/255 above
            ringed = block.copy(); ringed[[0, 11], :] = (0, 0, 0, alpha); ringed[:, [0, 11]] = (0, 0, 0, alpha)
            self.assertEqual(np.array_equal(pp.preprocess(ringed), pp.preprocess(block)), same_as_block, alpha)

    def test_composite_on_white_uses_alpha(self):
        out = pp.preprocess(pixel(0, 0, 0, 128))                                         # 255 * 127 / 255 = 127, inverted 128
        np.testing.assert_array_equal(out, np.full((1, 1, 28, 28), 128 / 255, dtype=np.float32))
        ghost = blank(9, 9); ghost[2:7, 2:7] = (0, 0, 0, 255); ghost[0, 0] = (0, 0, 0, 5); ghost[8, 8] = (9, 9, 9, 0)
        np.testing.assert_array_equal(pp.preprocess(ghost), pp.preprocess(ghost[2:7, 2:7]))   # near-transparent pixels are ignored

    def test_greyscale_weights_and_invert(self):
        # black gives 1.0 and white 0.0 (garment light on black); the others are 299, 587, 114 per mille rounded half up, then inverted
        for rgb, grey in (((0, 0, 0), 0), ((255, 255, 255), 255), ((255, 0, 0), 76), ((0, 255, 0), 150), ((0, 0, 255), 29)):
            np.testing.assert_array_equal(pp.preprocess(pixel(*rgb, 255)), np.full((1, 1, 28, 28), (255 - grey) / 255, dtype=np.float32))

    def test_longer_side_is_scaled_to_28_and_centred(self):
        def box(h, w):
            rgba = blank(h + 6, w + 6); rgba[3:3 + h, 3:3 + w] = (0, 0, 0, 255)          # black garment: 1.0 where it lands
            ys, xs = np.nonzero(pp.preprocess(rgba)[0, 0])
            return ys.min(), ys.max(), xs.min(), xs.max()
        self.assertEqual(box(40, 10), (0, 27, 10, 16))                                    # 7 wide, centred: (28 - 7) // 2 = 10
        self.assertEqual(box(10, 40), (10, 16, 0, 27))
        self.assertEqual(box(28, 13), (0, 27, 7, 19))                                     # odd gap of 15: the extra pixel goes right
        self.assertEqual(box(3, 3), (0, 27, 0, 27))                                       # small cut-outs are scaled up

    def test_resize_is_lanczos(self):
        # PIL rounds to 8 bits after each pass, so a float Lanczos-3 agrees within 8 levels; bicubic is 20 or more away
        for name in ("random noise with random alpha", "tiny 5x7 upscaled"):
            rgba = fixtures()[name]
            diff = np.abs(pp.preprocess(rgba).astype(np.float64) - reference(rgba, resize=lanczos_numpy)) * 255
            self.assertLessEqual(diff.max(), 8.0, name)

    def test_bad_input_is_refused(self):
        for bad in (blank(8, 8), np.full((8, 8, 4), 25, dtype=np.uint8)):               # nothing above 10% alpha
            with self.assertRaisesRegex(ValueError, "no pixel"):
                pp.preprocess(bad)
        for bad in (np.zeros((8, 8, 3), dtype=np.uint8), np.zeros((8, 8, 4), dtype=np.float32), np.zeros((0, 8, 4), dtype=np.uint8)):
            with self.assertRaises(ValueError):
                pp.preprocess(bad)

    def test_normalise_for_idx_batches(self):
        batch = (np.arange(2 * 784) % 256).astype(np.uint8).reshape(2, 28, 28)
        out = pp.normalise(batch)
        self.assertEqual((out.shape, out.dtype), ((2, 1, 28, 28), np.float32))
        np.testing.assert_array_equal(out[:, 0], (batch / 255).astype(np.float32))
        self.assertEqual(pp.normalise(batch[0]).shape, (1, 1, 28, 28))
        with self.assertRaises(ValueError):
            pp.normalise(np.zeros((2, 28, 27), dtype=np.uint8))
