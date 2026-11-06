"""Worker.process / run_once with a fake database: the classification of outcomes (permanent, retry, discard) and the polling rules."""
import logging
import threading

import psycopg
import pytest

from helpers import USER, FakeRemover, FakeStorage, garment_photo, make_job
from worker.db import Job
from worker.images import ImageRejected
from worker.loop import Worker, error_code
from worker.storage import StorageError


class FakeDb:
    def __init__(self, jobs=(), accept=True):
        self.jobs, self.accept, self.log, self.beats, self.closed = list(jobs), accept, [], [], 0

    def claim(self):
        return self.jobs.pop(0) if self.jobs else None

    def succeed(self, job, result):
        self.log.append(("done", job.id, result)); return self.accept

    def fail(self, job, code):
        self.log.append(("failed", job.id, code)); return self.accept

    def retry_or_fail(self, job, code):
        self.log.append(("retry", job.id, code)); return "queued"

    def heartbeat(self, wid, version):
        self.beats.append(wid)

    def close(self):
        self.closed += 1


class BoomStorage:
    def __init__(self, exc): self.exc = exc
    def signed_urls(self, job_id): raise self.exc


def worker(db, storage, **kw):
    return Worker(db, storage, FakeRemover(), None, "w1", clock=kw.get("clock", lambda: 0.0))


def png():
    import io
    b = io.BytesIO(); garment_photo().save(b, format="PNG"); return b.getvalue()


def test_success_writes_done_with_the_result():
    job = make_job(); db = FakeDb([job])
    assert worker(db, FakeStorage(job, png())).run_once() is True
    assert db.log[0][0] == "done" and db.log[0][2]["path"].endswith("-cutout.webp")


def test_empty_queue_returns_false():
    assert worker(FakeDb(), None).run_once() is False


def test_a_rejected_picture_fails_at_once_without_retry():
    job = make_job(); db = FakeDb([job])
    worker(db, FakeStorage(job, b"junk")).run_once()
    assert db.log == [("failed", job.id, "not_an_image")]


def test_a_storage_error_goes_to_retry_with_its_code():
    job = make_job(); db = FakeDb([job])
    worker(db, BoomStorage(StorageError("signed_urls_http_500"))).run_once()
    assert db.log == [("retry", job.id, "signed_urls_http_500")]


def test_an_unexpected_exception_is_stored_by_type_only():
    job = make_job(); db = FakeDb([job])
    worker(db, BoomStorage(RuntimeError(f"leak {USER} http://x?token=zzz"))).run_once()
    assert db.log == [("retry", job.id, "handler_error_RuntimeError")]
    assert "zzz" not in str(db.log) and USER not in str(db.log)


def test_receipt_jobs_are_failed_not_attempted():
    job = make_job(jtype="receipt"); db = FakeDb([job])
    worker(db, BoomStorage(AssertionError("must not be called"))).run_once()
    assert db.log == [("failed", job.id, "unsupported_job_type")]


def test_a_discarded_result_is_reported_as_discarded():
    job = make_job()
    assert worker(FakeDb([job], accept=False), FakeStorage(job, png())).process(job) == "discarded"


def test_error_code_is_bounded_and_never_the_message():
    class LongName(Exception): pass
    assert error_code(ImageRejected("animated_image")) == "animated_image"
    assert error_code(LongName("secret")) == "handler_error_LongName" and "secret" not in error_code(LongName("secret"))


def test_heartbeat_every_60_seconds_not_more_often():
    t = [0.0]; db = FakeDb(); w = worker(db, None, clock=lambda: t[0])
    w.beat_if_due(); t[0] = 59; w.beat_if_due(); assert len(db.beats) == 1
    t[0] = 61; w.beat_if_due(); assert len(db.beats) == 2


def test_idle_loop_polls_with_the_configured_pause_and_stops():
    stop = threading.Event(); waits = []
    db = FakeDb()
    w = Worker(db, None, FakeRemover(), None, "w1", poll_seconds=3.0)
    orig = stop.wait
    stop.wait = lambda timeout=None: (waits.append(timeout), stop.set())[0]
    w.run_forever(stop)
    assert waits == [3.0] and len(db.beats) == 1


def test_busy_loop_does_not_wait_between_jobs():
    stop = threading.Event(); waits = []
    jobs = [make_job(i) for i in (1, 2)]
    db = FakeDb(jobs)
    class St:
        def signed_urls(self, i):
            raise StorageError("x")
    w = Worker(db, St(), FakeRemover(), None, "w1", poll_seconds=3.0)
    stop.wait = lambda timeout=None: (waits.append(timeout), stop.set())[0]
    w.run_forever(stop)
    assert [e[1] for e in db.log] == [1, 2] and waits == [3.0]        # waited only once the queue was empty


def test_database_errors_close_the_connection_and_back_off(caplog):
    class Down(FakeDb):
        def claim(self):
            raise psycopg.OperationalError("connection to server at 10.0.0.1 failed")
    stop = threading.Event(); waits = []
    db = Down()
    w = Worker(db, None, FakeRemover(), None, "w1")
    stop.wait = lambda timeout=None: (waits.append(timeout), len(waits) >= 3 and stop.set())[0]
    with caplog.at_level(logging.DEBUG):
        w.run_forever(stop)
    assert waits == [1.0, 2.0, 4.0] and db.closed == 3
    assert "10.0.0.1" not in caplog.text
