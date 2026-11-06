"""The photo handler (LLD 7.3). Returns the result object; raises ImageRejected / StorageError / anything else for the loop to classify."""
from __future__ import annotations

import logging
from typing import Protocol

from PIL import Image

from .background import BackgroundRemover
from .db import Job
from .images import ImageRejected, dominant_rgb, load_image, make_outputs
from .storage import PHOTO_KINDS, JobUrls, StorageError

log = logging.getLogger("worker.handler")


class Garment(Protocol):
    def infer(self, cutout: Image.Image) -> dict: ...


class Storage(Protocol):
    def signed_urls(self, job_id: int) -> JobUrls: ...
    def download(self, url: str) -> bytes: ...
    def upload(self, url: str, data: bytes) -> None: ...


def input_path(job: Job) -> str:
    """The one photo of the job: `path`, else the first of `paths`."""
    p = job.input.get("path")
    if p is None:
        paths = job.input.get("paths")
        p = paths[0] if isinstance(paths, list) and paths else None
    if not isinstance(p, str):
        raise ImageRejected("invalid_job_input")
    return p


def handle_photo(job: Job, storage: Storage, remover: BackgroundRemover, garment: Garment | None) -> dict:
    wanted = input_path(job)
    urls = storage.signed_urls(job.id)
    source = [url for path, url in urls.downloads if path == wanted]
    if len(source) != 1 or set(urls.uploads) != set(PHOTO_KINDS):
        raise StorageError("unexpected_signed_urls")
    for kind, (path, _) in urls.uploads.items():                # outputs must sit in the owner's folder and carry the job id
        if not path.startswith(f"{job.user_id}/{job.id}-"):
            raise StorageError("unexpected_upload_path")

    original = load_image(storage.download(source[0]))
    cutout = remover.remove(original)
    if cutout.size != original.size or cutout.mode != "RGBA":
        raise ValueError("background remover returned the wrong picture")
    files = make_outputs(original, cutout)
    colour = dominant_rgb(cutout)

    guess = None
    if garment is not None:                                       # optional step: an error here never fails or retries the job
        try:
            guess = garment.infer(cutout)
        except Exception as exc:
            log.warning("garment guess failed: %s", type(exc).__name__)

    for kind in PHOTO_KINDS:
        storage.upload(urls.uploads[kind][1], files[kind])
    return {"path": urls.uploads["cutout"][0], "thumb_path": urls.uploads["thumb"][0],
            "original_thumb_path": urls.uploads["original_thumb"][0], "dominant_rgb": colour, "garment": guess}
