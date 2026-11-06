"""Garment preprocessing, LLD 7.7: the one implementation used by evaluation and the worker.

Input: an RGBA cut-out (uint8 array (H, W, 4) or PIL image). Output: float32 array (1, 1, 28, 28). Steps: (1) crop
to the bounding box of alpha above 10% (alpha >= 26); (2) composite on white; (3) greyscale (0.299 R + 0.587 G +
0.114 B); (4) invert; (5) scale the longer side to 28 with Lanczos, centre on a black 28 by 28 canvas; (6) divide by
255. Colour arithmetic is integer with round-half-up, so results are identical on every machine. ValueError on a
bad array or a cut-out with no pixel above the alpha threshold.
"""
import numpy as np
from PIL import Image

SIDE = 28
ALPHA_NUM, ALPHA_DEN = 1, 10      # alpha threshold as a fraction of 255: alpha * 10 > 255

def normalise(grey):
    """Step 6 for uint8 pictures shaped (28, 28) or (N, 28, 28): float32 in 0 to 1, shaped (N, 1, 28, 28)."""
    grey = np.asarray(grey)
    if grey.ndim == 2:
        grey = grey[None]
    if grey.ndim != 3 or grey.shape[1:] != (SIDE, SIDE) or grey.dtype != np.uint8:
        raise ValueError(f"expected uint8 pictures of 28 by 28, got {grey.dtype} {grey.shape}")
    return grey[:, None, :, :].astype(np.float32) / np.float32(255)

def _as_rgba(cutout):
    if isinstance(cutout, Image.Image):
        cutout = np.asarray(cutout.convert("RGBA"))
    cutout = np.asarray(cutout)
    if cutout.ndim != 3 or cutout.shape[2] != 4 or cutout.dtype != np.uint8 or 0 in cutout.shape:
        raise ValueError(f"expected a non-empty uint8 RGBA array (H, W, 4), got {cutout.dtype} {cutout.shape}")
    return cutout

def preprocess(cutout):
    rgba = _as_rgba(cutout)
    alpha = rgba[:, :, 3].astype(np.int64)
    inside = alpha * ALPHA_DEN > 255 * ALPHA_NUM                                   # step 1: alpha above 10%
    if not inside.any():
        raise ValueError("cut-out has no pixel with alpha above 10%")
    rows, cols = np.flatnonzero(inside.any(axis=1)), np.flatnonzero(inside.any(axis=0))
    rgba = rgba[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1].astype(np.int64)
    a = rgba[:, :, 3:4]
    white = (rgba[:, :, :3] * a + 255 * (255 - a) + 127) // 255                    # step 2: composite on white
    grey = (299 * white[:, :, 0] + 587 * white[:, :, 1] + 114 * white[:, :, 2] + 500) // 1000   # step 3
    inverted = (255 - grey).astype(np.uint8)                                       # step 4: garment light on black
    h, w = inverted.shape
    long_side = max(h, w)
    new_h = max(1, (2 * h * SIDE + long_side) // (2 * long_side))                  # step 5: longer side to 28
    new_w = max(1, (2 * w * SIDE + long_side) // (2 * long_side))
    small = Image.fromarray(inverted, "L").resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = np.zeros((SIDE, SIDE), dtype=np.uint8)
    top, left = (SIDE - new_h) // 2, (SIDE - new_w) // 2
    canvas[top:top + new_h, left:left + new_w] = np.asarray(small)
    return normalise(canvas)                                                       # step 6
