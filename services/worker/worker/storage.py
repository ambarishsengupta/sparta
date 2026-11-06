"""Bytes in and out of storage ONLY through the signed URLs from POST /api/worker/signed-urls (LLD 7.1). The worker holds no storage key.

Signed URLs of the local stack carry http://127.0.0.1:54321, which a container cannot reach, so SIGNED_URL_HOST_REWRITE (an allow-listed
host:port) replaces the host of such local URLs. URLs for any other host are never rewritten; every URL is checked before it is used.
Nothing here logs a URL, a path or a token: the signed token is in the query string.
"""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit, urlunsplit

import httpx

from .config import LOCAL_HOSTS, Settings
from .images import MAX_BYTES

STORAGE_PREFIX = "/storage/v1/object/"
PHOTO_KINDS = ("cutout", "thumb", "original_thumb")
CONTENT_TYPE = "image/webp"
TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class StorageError(Exception):
    """A signed-URL or storage step failed. `code` is a fixed word (no URL, no path, no body)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class JobUrls:
    downloads: list[tuple[str, str]]          # (path, url)
    uploads: dict[str, tuple[str, str]]       # kind -> (path, url)


def rewrite_signed_url(url: str, settings: Settings) -> str:
    """Validate a signed URL and apply the host rewrite. Raises StorageError('bad_signed_url') for anything unexpected."""
    try:
        parts = urlsplit(url)
        host, port = parts.hostname, parts.port
    except ValueError:
        raise StorageError("bad_signed_url") from None
    local = host in LOCAL_HOSTS
    if parts.scheme not in ("http", "https") or not host or parts.username is not None or parts.fragment:
        raise StorageError("bad_signed_url")
    if parts.scheme == "http" and not local:
        raise StorageError("bad_signed_url")
    if not parts.path.startswith(STORAGE_PREFIX) or ".." in parts.path or "token" not in parse_qs(parts.query):
        raise StorageError("bad_signed_url")
    if settings.signed_url_allowed_hosts and host not in settings.signed_url_allowed_hosts and not (local and settings.signed_url_host_rewrite):
        raise StorageError("bad_signed_url")
    if local and settings.signed_url_host_rewrite:
        parts = parts._replace(netloc=settings.signed_url_host_rewrite)
    return urlunsplit(parts)


class SignedUrlClient:
    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self._s = settings
        self._http = client or httpx.Client(timeout=TIMEOUT, follow_redirects=False)

    def signed_urls(self, job_id: int) -> JobUrls:
        try:
            r = self._http.post(f"{self._s.api_base_url}/api/worker/signed-urls", json={"job_id": job_id},
                                headers={"authorization": f"Bearer {self._s.api_token}"})
        except httpx.HTTPError:
            raise StorageError("signed_urls_unreachable") from None
        if r.status_code != 200:
            raise StorageError(f"signed_urls_http_{r.status_code}")
        try:
            body = r.json()
            downloads = [(d["path"], rewrite_signed_url(d["url"], self._s)) for d in body["downloads"]]
            uploads = {u["kind"]: (u["path"], rewrite_signed_url(u["url"], self._s)) for u in body["uploads"]}
            if body["job_id"] != job_id or not all(isinstance(p, str) for p, _ in downloads):
                raise StorageError("bad_signed_urls_body")
        except StorageError:
            raise
        except (ValueError, KeyError, TypeError):
            raise StorageError("bad_signed_urls_body") from None
        return JobUrls(downloads, uploads)

    def download(self, url: str) -> bytes:
        """GET with a hard size limit: reading stops one byte past 5 MB."""
        try:
            with self._http.stream("GET", url) as r:
                if r.status_code != 200:
                    raise StorageError(f"download_http_{r.status_code}")
                buf = bytearray()
                for chunk in r.iter_bytes():
                    buf.extend(chunk)
                    if len(buf) > MAX_BYTES:
                        raise StorageError("download_too_large")
                return bytes(buf)
        except httpx.HTTPError:
            raise StorageError("download_failed") from None

    def upload(self, url: str, data: bytes) -> None:
        """PUT to a signed upload URL (the token in the URL decides the path); x-upsert so a retried job overwrites its own files."""
        try:
            r = self._http.put(url, content=data, headers={"content-type": CONTENT_TYPE, "x-upsert": "true", "cache-control": "max-age=3600"})
        except httpx.HTTPError:
            raise StorageError("upload_failed") from None
        if r.status_code not in (200, 201):
            raise StorageError(f"upload_http_{r.status_code}")
