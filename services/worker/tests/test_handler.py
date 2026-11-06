import io
import logging

import pytest
from PIL import Image

from helpers import USER, FakeRemover, FakeStorage, garment_photo, make_job, png_bytes
from worker.handler import handle_photo, input_path
from worker.images import ImageRejected
from worker.storage import StorageError


def photo_bytes() -> bytes:
    out = io.BytesIO()
    garment_photo().save(out, format="PNG")
    return out.getvalue()


class FakeGarment:
    def __init__(self, result=None, error=None):
        self.result, self.error, self.calls = result, error, 0

    def infer(self, cutout):
        self.calls += 1
        if self.error:
            raise self.error
        return self.result


GUESS = {"model_version": "garment-cnn-v1", "class": 7, "p": 0.93, "category": "Footwear", "sub_type": "Sneakers", "embedding": [0.0] * 32}


def test_result_follows_the_lld_7_3_schema_and_uploads_three_files():
    job = make_job()
    st = FakeStorage(job, photo_bytes())
    result = handle_photo(job, st, FakeRemover(), FakeGarment(GUESS))
    assert set(result) == {"path", "thumb_path", "original_thumb_path", "dominant_rgb", "garment"}
    assert result["path"] == f"{USER}/7-cutout.webp" and result["thumb_path"] == f"{USER}/7-thumb.webp"
    assert result["original_thumb_path"] == f"{USER}/7-orig-thumb.webp" and result["garment"] == GUESS
    r, g, b = result["dominant_rgb"]
    assert r > 150 and g < 80 and b < 80
    assert set(st.uploaded) == {"put://cutout", "put://thumb", "put://original_thumb"}
    assert all(Image.open(io.BytesIO(v)).format == "WEBP" for v in st.uploaded.values())


def test_guess_is_none_when_no_garment_model_is_given():
    job = make_job()
    assert handle_photo(job, FakeStorage(job, photo_bytes()), FakeRemover(), None)["garment"] is None


def test_a_failing_garment_step_neither_fails_nor_retries_the_job():
    job = make_job()
    result = handle_photo(job, FakeStorage(job, photo_bytes()), FakeRemover(), FakeGarment(error=RuntimeError("boom")))
    assert result["garment"] is None and result["path"].endswith("-cutout.webp")


def test_input_may_come_from_paths():
    job = make_job(path=None)
    job = type(job)(job.id, job.user_id, job.type, {"paths": [f"{USER}/a.png", f"{USER}/b.png"]}, 1)
    assert input_path(job) == f"{USER}/a.png"


def test_input_without_a_path_is_rejected():
    job = type(make_job())(1, USER, "photo", {"currency": "GBP"}, 1)
    with pytest.raises(ImageRejected):
        input_path(job)


def test_the_download_must_be_the_jobs_own_input():
    job = make_job()
    st = FakeStorage(job, photo_bytes())
    st.urls = type(st.urls)([("someone-else/x.png", "get://in")], st.urls.uploads)
    with pytest.raises(StorageError):
        handle_photo(job, st, FakeRemover(), None)
    assert not any(c[0] == "get" for c in st.calls)


def test_a_missing_upload_kind_is_refused_before_any_work():
    job = make_job()
    st = FakeStorage(job, photo_bytes(), kinds=("cutout", "thumb"))
    remover = FakeRemover()
    with pytest.raises(StorageError):
        handle_photo(job, st, remover, None)
    assert remover.calls == 0 and not st.uploaded


def test_upload_paths_must_be_in_the_owners_folder_with_the_job_id():
    job = make_job()
    st = FakeStorage(job, photo_bytes())
    st.urls.uploads["cutout"] = ("other-user/7-cutout.webp", "put://cutout")
    with pytest.raises(StorageError):
        handle_photo(job, st, FakeRemover(), None)
    st2 = FakeStorage(job, photo_bytes())
    st2.urls.uploads["thumb"] = (f"{USER}/8-thumb.webp", "put://thumb")
    with pytest.raises(StorageError):
        handle_photo(job, st2, FakeRemover(), None)


def test_a_bad_picture_is_rejected_and_nothing_is_uploaded():
    job = make_job()
    st = FakeStorage(job, b"not an image")
    with pytest.raises(ImageRejected):
        handle_photo(job, st, FakeRemover(), None)
    assert not st.uploaded


def test_a_remover_that_returns_the_wrong_size_is_an_error():
    class Bad:
        def remove(self, image):
            return Image.new("RGBA", (3, 3))
    job = make_job()
    with pytest.raises(ValueError):
        handle_photo(job, FakeStorage(job, photo_bytes()), Bad(), None)


def test_exif_rotated_photo_is_processed_upright():
    img = Image.new("RGB", (80, 40), (200, 30, 30))
    exif = Image.Exif()
    exif[0x0112] = 6
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    job = make_job()
    st = FakeStorage(job, buf.getvalue())
    handle_photo(job, st, FakeRemover(), None)
    assert Image.open(io.BytesIO(st.uploaded["put://original_thumb"])).size == (40, 80)


def test_upload_failure_is_not_swallowed_and_no_result_is_returned():
    job = make_job()
    st = FakeStorage(job, photo_bytes())

    def boom(url, data):
        raise StorageError("upload_http_500")
    st.upload = boom
    with pytest.raises(StorageError):
        handle_photo(job, st, FakeRemover(), None)


def test_logs_never_hold_image_bytes_paths_or_user_ids(caplog):
    caplog.set_level(logging.DEBUG)
    job = make_job()
    handle_photo(job, FakeStorage(job, photo_bytes()), FakeRemover(), FakeGarment(error=ValueError(f"secret {USER} photo.png")))
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert USER not in text and "photo.png" not in text and "RIFF" not in text and "PNG" not in text
