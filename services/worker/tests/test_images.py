import io

import numpy as np
import pytest
from PIL import Image

from helpers import garment_photo, png_bytes
from worker import images
from worker.images import ImageRejected, dominant_rgb, fit_long_side, load_image, make_outputs, to_webp


def jpeg_with_orientation(orientation, size=(80, 40)) -> bytes:
    img = Image.new("RGB", size, (10, 120, 200))
    exif = Image.Exif()
    exif[0x0112] = orientation
    out = io.BytesIO()
    img.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def test_a_normal_picture_loads():
    img = load_image(png_bytes(64, 48))
    assert img.size == (64, 48) and img.mode == "RGB"


def test_picture_over_5_mb_is_refused_before_decoding():
    with pytest.raises(ImageRejected) as e:
        load_image(b"\x89PNG" + b"0" * (5 * 1024 * 1024))
    assert e.value.code == "file_too_large"


@pytest.mark.parametrize("data", [b"", b"hello world", b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"GIF89a" + b"0" * 30, b"%PDF-1.4 " + b"0" * 50])
def test_non_images_and_other_formats_are_refused(data):
    with pytest.raises(ImageRejected) as e:
        load_image(data)
    assert e.value.code == "not_an_image"


def test_truncated_picture_is_refused():
    with pytest.raises(ImageRejected) as e:
        load_image(png_bytes(300, 300)[:120])
    assert e.value.code == "not_an_image"


def test_type_comes_from_the_content_not_a_name():
    out = io.BytesIO()
    Image.new("RGB", (8, 8)).save(out, format="WEBP")
    assert load_image(out.getvalue()).size == (8, 8)            # no file name is ever looked at


def test_more_than_6000_pixels_on_the_long_side_is_refused():
    for size in ((6001, 10), (10, 6001)):
        with pytest.raises(ImageRejected) as e:
            load_image(png_bytes(*size, mode="L", colour=0))
        assert e.value.code == "image_too_large"


def test_decompression_bomb_is_refused_without_decoding(monkeypatch):
    # a tiny file that claims a huge canvas: the header check rejects it before any pixel is decoded
    data = png_bytes(60000, 60000, mode="1", colour=0)
    assert len(data) < 1_000_000
    called = []
    monkeypatch.setattr(Image.Image, "load", lambda self, *a: called.append(1))
    with pytest.raises(ImageRejected) as e:
        load_image(data)
    assert e.value.code == "image_too_large" and not called


def test_pixel_count_limit_applies_even_when_each_side_is_allowed(monkeypatch):
    monkeypatch.setattr(images, "MAX_PIXELS", 1000)
    with pytest.raises(ImageRejected) as e:
        load_image(png_bytes(40, 40))
    assert e.value.code == "image_too_large"


def test_animated_pictures_are_refused():
    frames = [Image.new("RGB", (16, 16), c) for c in ((255, 0, 0), (0, 255, 0))]
    out = io.BytesIO()
    frames[0].save(out, format="WEBP", save_all=True, append_images=frames[1:], duration=50)
    with pytest.raises(ImageRejected) as e:
        load_image(out.getvalue())
    assert e.value.code == "animated_image"
    apng = io.BytesIO()
    frames[0].save(apng, format="PNG", save_all=True, append_images=frames[1:])
    with pytest.raises(ImageRejected) as e:
        load_image(apng.getvalue())
    assert e.value.code == "animated_image"


def test_exif_rotation_is_applied():
    assert load_image(jpeg_with_orientation(6)).size == (40, 80)           # 90 degrees: width and height swap
    assert load_image(jpeg_with_orientation(1)).size == (80, 40)


def test_transparency_is_kept():
    assert load_image(png_bytes(8, 8, colour=(1, 2, 3, 0), mode="RGBA")).mode == "RGBA"


def test_fit_long_side_shrinks_but_never_enlarges():
    assert fit_long_side(Image.new("RGB", (2400, 1200)), 1200).size == (1200, 600)
    assert fit_long_side(Image.new("RGB", (100, 50)), 1200).size == (100, 50)
    assert fit_long_side(Image.new("RGB", (1, 3000)), 320).size[1] == 320 and fit_long_side(Image.new("RGB", (1, 3000)), 320).size[0] >= 1


def test_outputs_sizes_format_and_transparency():
    original = Image.new("RGB", (3000, 2000), (255, 255, 255))
    cut = Image.new("RGBA", (3000, 2000), (200, 30, 30, 0))
    cut.paste(Image.new("RGBA", (1000, 1000), (200, 30, 30, 255)), (500, 500))
    out = make_outputs(original, cut)
    assert set(out) == {"cutout", "thumb", "original_thumb"}
    sizes = {k: Image.open(io.BytesIO(v)) for k, v in out.items()}
    assert all(i.format == "WEBP" for i in sizes.values())
    assert sizes["cutout"].size == (1200, 800) and sizes["thumb"].size == (320, 213) and sizes["original_thumb"].size == (320, 213)
    assert sizes["cutout"].mode == "RGBA" and sizes["cutout"].getpixel((0, 0))[3] == 0 and sizes["cutout"].getpixel((400, 400))[3] == 255


def test_webp_quality_is_80():
    noisy = Image.fromarray(np.random.default_rng(1).integers(0, 255, (200, 200, 3), dtype=np.uint8))
    assert len(to_webp(noisy)) < len(to_webp(noisy, quality=100))
    assert len(to_webp(noisy)) > len(to_webp(noisy, quality=20))
    assert images.WEBP_QUALITY == 80 and to_webp(noisy) == to_webp(noisy, quality=80)


def test_limits_are_the_lld_values():
    assert (images.MAX_BYTES, images.MAX_SIDE, images.OUTPUT_SIDE, images.THUMB_SIDE) == (5 * 1024 * 1024, 6000, 1200, 320)


def test_dominant_colour_is_the_garment_not_the_wall():
    cut = Image.new("RGBA", (100, 100), (255, 255, 255, 0))
    cut.paste(Image.new("RGBA", (60, 60), (200, 30, 30, 255)), (20, 20))
    r, g, b = dominant_rgb(cut)
    assert abs(r - 200) <= 3 and abs(g - 30) <= 3 and abs(b - 30) <= 3


def test_dominant_colour_skips_near_white_and_transparent():
    cut = Image.new("RGBA", (100, 100), (250, 250, 250, 255))                  # large near-white area
    cut.paste(Image.new("RGBA", (20, 20), (10, 40, 200, 255)), (0, 0))        # small blue patch
    r, g, b = dominant_rgb(cut)
    assert b > 150 and r < 60 and g < 90                                      # the blue patch, not the near-white area
    assert dominant_rgb(Image.new("RGBA", (10, 10), (1, 2, 3, 0))) is None   # nothing opaque
    assert dominant_rgb(Image.new("RGBA", (10, 10), (255, 255, 255, 255))) == [255, 255, 255]     # white garment: better than nothing


def test_dominant_colour_is_deterministic():
    img = garment_photo().convert("RGBA")
    assert dominant_rgb(img) == dominant_rgb(img.copy())
