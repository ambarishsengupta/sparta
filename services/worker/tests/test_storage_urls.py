import json

import httpx
import pytest

from helpers import base_env
from worker.config import Settings
from worker.storage import SignedUrlClient, StorageError, rewrite_signed_url

BASE = base_env()
LOCAL = "http://127.0.0.1:54321/storage/v1/object/sign/item-images/u/a.png?token=abc"


def settings(**kw):
    return Settings.from_env({**BASE, **kw})


def test_local_url_is_rewritten_to_the_configured_host():
    out = rewrite_signed_url(LOCAL, settings(SIGNED_URL_HOST_REWRITE="host.docker.internal:54321"))
    assert out == "http://host.docker.internal:54321/storage/v1/object/sign/item-images/u/a.png?token=abc"


def test_no_rewrite_when_not_configured():
    assert rewrite_signed_url(LOCAL, settings()) == LOCAL


def test_cloud_url_is_never_rewritten():
    cloud = "https://abc.supabase.co/storage/v1/object/sign/item-images/u/a.png?token=abc"
    assert rewrite_signed_url(cloud, settings(SIGNED_URL_HOST_REWRITE="host.docker.internal:54321")) == cloud


@pytest.mark.parametrize("url", [
    "http://evil.example/storage/v1/object/sign/b/u/a.png?token=abc",                  # plain http to a non-local host
    "https://evil.example/other/path?token=abc",                                       # not a storage path
    "https://abc.supabase.co/storage/v1/object/sign/b/../../x?token=abc",              # path climbing
    "https://abc.supabase.co/storage/v1/object/sign/b/u/a.png",                        # no token
    "https://user:pw@abc.supabase.co/storage/v1/object/sign/b/u/a.png?token=abc",      # user info
    "file:///etc/passwd", "ftp://abc.supabase.co/storage/v1/object/x?token=a", "not a url", "https://abc.supabase.co:badport/storage/v1/object/x?token=a",
    "https://abc.supabase.co/storage/v1/object/sign/b/u/a.png?token=abc#frag",
])
def test_bad_signed_urls_are_refused(url):
    with pytest.raises(StorageError) as e:
        rewrite_signed_url(url, settings())
    assert e.value.code == "bad_signed_url"


def test_allowed_hosts_list_is_enforced():
    s = settings(SIGNED_URL_ALLOWED_HOSTS="abc.supabase.co")
    ok = "https://abc.supabase.co/storage/v1/object/sign/b/u/a.png?token=abc"
    assert rewrite_signed_url(ok, s) == ok
    with pytest.raises(StorageError):
        rewrite_signed_url(ok.replace("abc.", "xyz."), s)


def api(handler):
    return SignedUrlClient(settings(SIGNED_URL_HOST_REWRITE="host.docker.internal:54321"), httpx.Client(transport=httpx.MockTransport(handler)))


GOOD = {"job_id": 5, "bucket": "item-images", "downloads": [{"path": "u/a.png", "url": LOCAL}],
        "uploads": [{"kind": "cutout", "path": "u/5-cutout.webp", "url": LOCAL.replace("/sign/", "/upload/sign/")}]}


def test_signed_urls_request_has_bearer_and_exact_body():
    seen = {}

    def handler(req):
        seen.update(auth=req.headers["authorization"], body=json.loads(req.content), url=str(req.url))
        return httpx.Response(200, json=GOOD)
    urls = api(handler).signed_urls(5)
    assert seen["auth"] == "Bearer " + "t" * 40 and seen["body"] == {"job_id": 5} and seen["url"].endswith("/api/worker/signed-urls")
    assert urls.downloads == [("u/a.png", LOCAL.replace("127.0.0.1", "host.docker.internal"))]    # rewritten for the container
    assert urls.uploads["cutout"][0] == "u/5-cutout.webp"


@pytest.mark.parametrize("status", [401, 404, 409, 429, 500])
def test_signed_urls_http_errors_become_codes(status):
    with pytest.raises(StorageError) as e:
        api(lambda r: httpx.Response(status, json={"error": {"code": "x", "message": "m"}})).signed_urls(5)
    assert e.value.code == f"signed_urls_http_{status}"


def test_signed_urls_wrong_job_or_shape_is_refused():
    with pytest.raises(StorageError):
        api(lambda r: httpx.Response(200, json={**GOOD, "job_id": 6})).signed_urls(5)
    with pytest.raises(StorageError):
        api(lambda r: httpx.Response(200, json={"downloads": []})).signed_urls(5)
    with pytest.raises(StorageError):
        api(lambda r: httpx.Response(200, text="not json")).signed_urls(5)


def test_download_stops_at_the_size_limit():
    big = b"x" * (5 * 1024 * 1024 + 1)
    with pytest.raises(StorageError) as e:
        api(lambda r: httpx.Response(200, content=big)).download("http://h/storage/v1/object/x?token=a")
    assert e.value.code == "download_too_large"
    assert api(lambda r: httpx.Response(200, content=b"abc")).download("http://h/x") == b"abc"


def test_download_and_upload_failures_become_codes():
    with pytest.raises(StorageError) as e:
        api(lambda r: httpx.Response(404)).download("http://h/x")
    assert e.value.code == "download_http_404"
    with pytest.raises(StorageError) as e:
        api(lambda r: httpx.Response(403)).upload("http://h/x", b"d")
    assert e.value.code == "upload_http_403"

    def boom(req):
        raise httpx.ConnectError("secret detail http://h/x?token=zzz")
    with pytest.raises(StorageError) as e:
        api(boom).upload("http://h/x", b"d")
    assert "zzz" not in str(e.value) and e.value.code == "upload_failed"


def test_upload_is_a_put_with_upsert_and_webp():
    seen = {}

    def handler(req):
        seen.update(method=req.method, up=req.headers["x-upsert"], ct=req.headers["content-type"], body=req.content)
        return httpx.Response(200, json={})
    api(handler).upload("http://h/x", b"RIFF")
    assert seen == {"method": "PUT", "up": "true", "ct": "image/webp", "body": b"RIFF"}
