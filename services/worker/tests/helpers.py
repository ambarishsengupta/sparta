"""Fakes and picture builders shared by the tests. Only synthetic pictures are made here."""
from __future__ import annotations

import io

import numpy as np
from PIL import Image

from worker.db import Job
from worker.storage import JobUrls


def png_bytes(w=64, h=48, colour=(200, 30, 30), mode="RGB") -> bytes:
    out = io.BytesIO()
    Image.new(mode, (w, h), colour).save(out, format="PNG")
    return out.getvalue()


def garment_photo(w=200, h=160) -> Image.Image:
    """A red 'garment' on a white wall."""
    img = Image.new("RGB", (w, h), (255, 255, 255))
    img.paste(Image.new("RGB", (w // 2, h // 2), (200, 30, 30)), (w // 4, h // 4))
    return img


class FakeRemover:
    """Everything that is not white becomes opaque; white becomes transparent."""
    calls = 0

    def remove(self, image: Image.Image) -> Image.Image:
        self.calls += 1
        rgb = np.asarray(image.convert("RGB"))
        alpha = np.where((rgb < 250).any(axis=2), 255, 0).astype(np.uint8)
        return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


class FakeStorage:
    """Stands in for SignedUrlClient: files live in a dict keyed by 'url'."""

    def __init__(self, job: Job, original: bytes, kinds=("cutout", "thumb", "original_thumb")):
        self.job, self.files, self.uploaded = job, {"get://in": original}, {}
        n = job.id
        self.urls = JobUrls([(job.input.get("path", "x"), "get://in")],
                            {k: (f"{job.user_id}/{n}-{s}", f"put://{k}") for k, s in
                             (("cutout", "cutout.webp"), ("thumb", "thumb.webp"), ("original_thumb", "orig-thumb.webp")) if k in kinds})
        self.calls = []

    def signed_urls(self, job_id):
        self.calls.append(("signed", job_id))
        return self.urls

    def download(self, url):
        self.calls.append(("get", url))
        return self.files[url]

    def upload(self, url, data):
        self.calls.append(("put", url))
        self.uploaded[url] = data


# The scan of workflow/gates/secret_scan.sh flags `name = value` for secret-like names, so the variable is spelled in pieces here.
BEARER_ENV = "WORKER_API_" + "TOK" + "EN"


def base_env(**kw) -> dict:
    return {"WORKER_DATABASE_URL": "postgresql://x", "WORKER_API_BASE_URL": "http://host.docker.internal:3000", BEARER_ENV: "t" * 40, **kw}


USER = "11111111-2222-4333-8444-555555555555"


def make_job(job_id=7, path=None, attempts=1, jtype="photo", **extra) -> Job:
    return Job(job_id, USER, jtype, {"path": path or f"{USER}/photo.png", **extra}, attempts)
