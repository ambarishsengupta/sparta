import logging
import threading

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from helpers import FakeRemover, base_env
from worker.app import configure_logging, create_app
from worker.background import BackgroundRemover, RembgRemover
from worker.config import Settings

SETTINGS = Settings.from_env(base_env(WORKER_RUN_LOOP="false"))


def test_health_is_the_only_route_and_docs_are_off():
    with TestClient(create_app(SETTINGS)) as c:
        r = c.get("/health")
        assert r.status_code == 200 and r.json()["status"] == "ok" and r.json()["loop"] is False
        for path in ("/docs", "/redoc", "/openapi.json", "/", "/jobs"):
            assert c.get(path).status_code == 404
        assert c.post("/health").status_code == 405


def test_the_loop_thread_starts_with_the_app_and_stops_with_it():
    started, stopped = threading.Event(), threading.Event()

    class W:
        def run_forever(self, stop):
            started.set(); stop.wait(); stopped.set()
    live = Settings.from_env(base_env(WORKER_API_BASE_URL="http://localhost:3000"))
    with TestClient(create_app(live, worker=W())) as c:
        assert started.wait(5) and c.get("/health").json()["loop"] is True
    assert stopped.wait(5)


def test_http_client_loggers_are_silenced_below_warning():
    configure_logging()                         # httpx logs full URLs at INFO and a signed URL carries its token
    assert logging.getLogger("httpx").level >= logging.WARNING and logging.getLogger("httpcore").level >= logging.WARNING


def test_the_fake_remover_satisfies_the_interface():
    r: BackgroundRemover = FakeRemover()
    out = r.remove(Image.new("RGB", (4, 4), (255, 255, 255)))
    assert out.mode == "RGBA" and out.getpixel((0, 0))[3] == 0


@pytest.mark.slow
def test_real_rembg_model_removes_a_plain_background():
    pytest.importorskip("rembg")
    img = Image.new("RGB", (320, 320), (240, 240, 240))
    arr = np.asarray(img).copy()
    yy, xx = np.mgrid[:320, :320]
    arr[((yy - 160) ** 2 / 110 ** 2 + (xx - 160) ** 2 / 70 ** 2) < 1] = (170, 20, 30)
    out = RembgRemover().remove(Image.fromarray(arr))
    alpha = np.asarray(out)[:, :, 3]
    assert out.size == (320, 320) and out.mode == "RGBA"
    assert alpha[5, 5] < 60 and alpha[160, 160] > 200               # corner is background, centre is the object
