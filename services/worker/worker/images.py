"""Image guards, resizing, WebP encoding and the dominant colour (LLD 7.3 steps 2, 4 and 5). Pure functions; no network, no logging."""
from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 5 * 1024 * 1024
MAX_SIDE = 6000
MAX_PIXELS = MAX_SIDE * MAX_SIDE
OUTPUT_SIDE = 1200
THUMB_SIDE = 320
WEBP_QUALITY = 80
ALLOWED_FORMATS = ("JPEG", "PNG", "WEBP")


class ImageRejected(Exception):
    """The picture can never be processed (a retry would fail the same way). `code` is a short fixed word; it is stored as last_error."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def load_image(data: bytes) -> Image.Image:
    """Validate by content (never the extension) and return an upright RGB or RGBA picture, fully decoded."""
    if len(data) > MAX_BYTES:
        raise ImageRejected("file_too_large")
    try:
        probe = Image.open(io.BytesIO(data), formats=ALLOWED_FORMATS)   # reads the header only; the format comes from the bytes
        w, h = probe.size
        if max(w, h) > MAX_SIDE or w * h > MAX_PIXELS or w < 1 or h < 1:
            raise ImageRejected("image_too_large")
        if getattr(probe, "is_animated", False) or getattr(probe, "n_frames", 1) > 1:
            raise ImageRejected("animated_image")
        probe.load()
    except ImageRejected:
        raise
    except Image.DecompressionBombError:
        raise ImageRejected("image_too_large") from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError):
        raise ImageRejected("not_an_image") from None
    img = ImageOps.exif_transpose(probe)                                 # EXIF rotation applied, then the tag is gone
    return img.convert("RGBA" if "A" in img.getbands() else "RGB")


def fit_long_side(img: Image.Image, side: int) -> Image.Image:
    """Shrink so the longer side is at most `side`; never enlarge."""
    w, h = img.size
    long_side = max(w, h)
    if long_side <= side:
        return img.copy()
    scale = side / long_side
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)


def to_webp(img: Image.Image, quality: int = WEBP_QUALITY) -> bytes:
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=quality, method=4)
    return out.getvalue()


def make_outputs(original: Image.Image, cutout: Image.Image) -> dict[str, bytes]:
    """The three files of LLD 7.3 step 4: the cut-out (at most 1,200 px, with transparency) and two 320 px thumbnails."""
    cut = fit_long_side(cutout.convert("RGBA"), OUTPUT_SIDE)
    return {
        "cutout": to_webp(cut),
        "thumb": to_webp(fit_long_side(cut, THUMB_SIDE)),
        "original_thumb": to_webp(fit_long_side(original.convert("RGB"), THUMB_SIDE)),
    }


def dominant_rgb(cutout: Image.Image, k: int = 3, near_white: int = 235) -> list[int] | None:
    """LLD 7.3 step 5: downsample, drop transparent pixels, k-means with k = 3 (deterministic start), the largest cluster that is not near-white."""
    small = fit_long_side(cutout.convert("RGBA"), 64)
    px = np.asarray(small).reshape(-1, 4)
    px = px[px[:, 3] > 128][:, :3].astype(np.float64)
    if len(px) == 0:
        return None
    centres = [px[len(px) // 2]]
    for _ in range(min(k, len(px)) - 1):                                  # farthest-point start: same input, same answer
        d = np.min([((px - c) ** 2).sum(axis=1) for c in centres], axis=0)
        centres.append(px[int(np.argmax(d))])
    c = np.array(centres)
    for _ in range(12):
        label = np.argmin(((px[:, None, :] - c[None, :, :]) ** 2).sum(axis=2), axis=1)
        c = np.array([px[label == i].mean(axis=0) if (label == i).any() else c[i] for i in range(len(c))])
    counts = np.bincount(label, minlength=len(c))
    for i in np.argsort(-counts, kind="stable"):
        if counts[i] and not (c[i] >= near_white).all():
            return [int(round(v)) for v in c[i]]
    return [int(round(v)) for v in c[int(np.argmax(counts))]]
