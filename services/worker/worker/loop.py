"""The background loop (LLD 7.1, 7.2, 7.6): one job at a time, poll every 3 s when idle, again at once after a job, heartbeat every 60 s."""
from __future__ import annotations

import logging
import threading
import time

import psycopg

from . import VERSION
from .db import Database, Job
from .handler import handle_photo
from .images import ImageRejected
from .storage import StorageError

log = logging.getLogger("worker.loop")
HEARTBEAT_SECONDS = 60.0


def error_code(exc: BaseException) -> str:
    """A fixed word for last_error: never the exception text (it could hold a path, a URL or a name)."""
    if isinstance(exc, (ImageRejected, StorageError)):
        return exc.code
    return "handler_error_" + type(exc).__name__[:60]


class Worker:
    def __init__(self, db: Database, storage, remover, garment, worker_id: str, poll_seconds: float = 3.0,
                 clock=time.monotonic, sleep=time.sleep):
        self.db, self.storage, self.remover, self.garment = db, storage, remover, garment
        self.worker_id, self.poll_seconds, self._clock, self._sleep = worker_id, poll_seconds, clock, sleep
        self._last_beat: float | None = None

    def process(self, job: Job) -> str:
        """Run one claimed job and write its outcome. Returns done, failed, queued or discarded."""
        log.info("job %s attempt %s started", job.id, job.attempts)
        try:
            if job.type != "photo":
                raise ImageRejected("unsupported_job_type")
            result = handle_photo(job, self.storage, self.remover, self.garment)
        except ImageRejected as exc:                                  # permanent: retrying cannot help
            outcome = "failed" if self.db.fail(job, exc.code) else "discarded"
        except Exception as exc:
            outcome = self.db.retry_or_fail(job, error_code(exc))
        else:
            outcome = "done" if self.db.succeed(job, result) else "discarded"
        log.info("job %s finished: %s", job.id, outcome)
        return outcome

    def run_once(self) -> bool:
        """Claim and process one job. False when the queue was empty."""
        job = self.db.claim()
        if job is None:
            return False
        self.process(job)
        return True

    def beat_if_due(self) -> None:
        now = self._clock()
        if self._last_beat is None or now - self._last_beat >= HEARTBEAT_SECONDS:
            self.db.heartbeat(self.worker_id, VERSION)
            self._last_beat = now

    def run_forever(self, stop: threading.Event) -> None:
        backoff = 1.0
        while not stop.is_set():
            try:
                self.beat_if_due()
                busy = self.run_once()
                backoff = 1.0
                if not busy:
                    stop.wait(self.poll_seconds)
            except psycopg.Error as exc:                              # database down or restarted: reconnect with a growing pause
                log.warning("database error: %s", type(exc).__name__)
                self.db.close()
                stop.wait(backoff)
                backoff = min(backoff * 2, 30.0)
