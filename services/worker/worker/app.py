"""FastAPI app: only /health (LLD 7.1, not published); the work is the background thread started with the app."""
from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import VERSION
from .config import Settings

log = logging.getLogger("worker.app")


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    for noisy in ("httpx", "httpcore"):                               # they log full URLs, and a signed URL carries its token
        logging.getLogger(noisy).setLevel(logging.WARNING)


def build_worker(settings: Settings):
    from .background import RembgRemover
    from .db import Database
    from .garment.model import GarmentModel
    from .loop import Worker
    from .storage import SignedUrlClient
    garment = GarmentModel(min_confidence=settings.garment_min_confidence) if settings.garment_guess_enabled else None
    return Worker(Database.from_url(settings.database_url), SignedUrlClient(settings), RembgRemover(), garment,
                  settings.worker_id, settings.poll_seconds)


def create_app(settings: Settings | None = None, worker=None) -> FastAPI:
    state = {"thread": None, "stop": threading.Event()}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        configure_logging()
        s = settings or Settings.from_env(os.environ)
        if s.run_loop:
            w = worker or build_worker(s)
            t = threading.Thread(target=w.run_forever, args=(state["stop"],), name="worker-loop", daemon=True)
            t.start()
            state["thread"] = t
            log.info("worker started (garment guess %s)", "on" if s.garment_guess_enabled else "off")
        yield
        state["stop"].set()
        if state["thread"]:
            state["thread"].join(timeout=10)

    app = FastAPI(title="sparta-worker", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    @app.get("/health")
    def health():
        t = state["thread"]
        return {"status": "ok", "version": VERSION, "loop": bool(t and t.is_alive())}

    return app


def app_factory() -> FastAPI:                                         # uvicorn --factory worker.app:app_factory
    return create_app()
