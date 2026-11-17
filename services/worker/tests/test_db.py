"""Real local database, connected as the limited role worker_role (LLD 7.1, 7.2). Needs the local Supabase stack."""
import concurrent.futures as cf
import io
import time

import psycopg
import pytest

from helpers import FakeRemover, FakeStorage, garment_photo
from worker.db import Database, Job
from worker.loop import Worker

pytestmark = pytest.mark.db


def row(admin, jid):
    return admin.execute("select status, attempts, last_error, result, run_after > now() + interval '20 seconds' from app.jobs where id = %s", (jid,)).fetchone()


def test_we_really_are_worker_role(wdb):
    assert wdb.conn.execute("select current_user").fetchone()[0] == "worker_role"


def test_claim_returns_the_oldest_due_job_and_counts_the_attempt(wdb, add_job, admin, user):
    a, b = add_job(), add_job()
    job = wdb.claim()
    assert (job.id, job.user_id, job.type, job.attempts) == (a, user, "photo", 1) and job.input["path"].startswith(user)
    assert row(admin, a)[:2] == ("running", 1) and row(admin, b)[:2] == ("queued", 0)
    assert wdb.claim().id == b and wdb.claim() is None


def test_a_job_that_is_not_due_yet_is_not_claimed(wdb, add_job):
    add_job(run_after_sql="now() + interval '1 hour'")
    assert wdb.claim() is None


def test_two_connections_never_claim_the_same_job_while_one_holds_the_lock(worker_url, add_job):
    a, b = add_job(), add_job()
    c1 = psycopg.connect(worker_url, autocommit=False)
    c2 = Database.from_url(worker_url)
    try:
        first = c1.execute("select id from app.claim_job()").fetchone()[0]          # claimed, not committed: the row stays locked
        second = c2.claim()
        assert first == a and second.id == b                                         # skip locked: the other session got the next one
        assert c2.claim() is None
    finally:
        c1.rollback(); c1.close(); c2.close()


def test_concurrent_claims_are_disjoint(worker_url, add_job):
    ids = {add_job() for _ in range(8)}

    def drain(_):
        db = Database.from_url(worker_url)
        got = []
        try:
            while (j := db.claim()):
                got.append(j.id)
        finally:
            db.close()
        return got
    with cf.ThreadPoolExecutor(4) as ex:
        results = list(ex.map(drain, range(4)))
    flat = [i for r in results for i in r]
    assert sorted(flat) == sorted(ids) and len(flat) == len(set(flat))               # every job once, none twice


def test_success_stores_the_result_and_marks_done(wdb, add_job, admin):
    jid = add_job(); job = wdb.claim()
    assert wdb.succeed(job, {"path": "p", "garment": None}) is True
    status, attempts, err, result, _ = row(admin, jid)
    assert (status, attempts, err, result) == ("done", 1, None, {"path": "p", "garment": None})
    assert admin.execute("select finished_at is not null from app.jobs where id = %s", (jid,)).fetchone()[0]


def test_retry_requeues_30_seconds_later_and_keeps_the_error(wdb, add_job, admin):
    jid = add_job(); job = wdb.claim()
    assert wdb.retry_or_fail(job, "download_failed") == "queued"
    status, attempts, err, _, later = row(admin, jid)
    assert (status, attempts, err, later) == ("queued", 1, "download_failed", True)
    assert wdb.claim() is None                                                       # not due for 30 seconds


def test_third_failure_is_final(wdb, add_job, admin):
    jid = add_job()
    for n in (1, 2):                                                                 # attempts 1 and 2 end as the reaper would end them (test set-up)
        job = wdb.claim() or pytest.fail("job not claimable")
        assert job.attempts == n
        admin.execute("update app.jobs set status = 'queued', last_error = 'reaped_stuck_running', run_after = now() where id = %s", (jid,))
    job = wdb.claim()
    assert job.attempts == 3 and wdb.retry_or_fail(job, "last_try") == "failed"      # no 30-second requeue after the third attempt
    assert row(admin, jid)[:3] == ("failed", 3, "last_try")
    assert wdb.claim() is None


def test_permanent_failure_ends_the_job_at_the_first_attempt(wdb, add_job, admin):
    jid = add_job(); job = wdb.claim()
    assert wdb.fail(job, "not_an_image") is True
    assert row(admin, jid)[:3] == ("failed", 1, "not_an_image")


def test_a_stale_claim_cannot_write_its_result(wdb, add_job, admin):
    jid = add_job(); job = wdb.claim()
    admin.execute("update app.jobs set status = 'queued', last_error = 'reaped_stuck_running', run_after = now() where id = %s", (jid,))   # the reaper's move
    second = wdb.claim()
    assert second.id == jid and second.attempts == 2
    assert wdb.succeed(job, {"stale": True}) is False and wdb.fail(job, "x") is False and wdb.retry_or_fail(job, "x") == "discarded"
    assert row(admin, jid)[:2] == ("running", 2)                                     # untouched by the stale worker
    assert wdb.succeed(second, {"fresh": True}) is True


def test_worker_role_cannot_read_user_tables(wdb):
    for q in ("select 1 from app.items limit 1", "select 1 from app.profiles limit 1", "select 1 from ops.invitations limit 1",
              "select 1 from auth.users limit 1", "select 1 from storage.objects limit 1"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            wdb.conn.execute(q)


def test_worker_role_cannot_change_input_or_create_jobs(wdb, add_job):
    add_job(); job = wdb.claim()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        wdb.conn.execute("update app.jobs set input = '{}'::jsonb where id = %s", (job.id,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        wdb.conn.execute("insert into app.jobs (user_id, type, input) values (%s, 'photo', '{}')", (job.user_id,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        wdb.conn.execute("delete from app.jobs where id = %s", (job.id,))


def test_heartbeat_inserts_then_updates_one_row(wdb, admin, add_job):
    add_job()
    try:
        wdb.heartbeat("wo0072-test", "0.1.0")
        r1 = admin.execute("select seen_at, queue_depth, version from ops.worker_heartbeat where worker_id = 'wo0072-test'").fetchone()
        assert r1[1] == 1 and r1[2] == "0.1.0"
        time.sleep(0.05); wdb.heartbeat("wo0072-test", "0.2.0")
        r2 = admin.execute("select seen_at, version from ops.worker_heartbeat where worker_id = 'wo0072-test'").fetchall()
        assert len(r2) == 1 and r2[0][0] > r1[0] and r2[0][1] == "0.2.0"
    finally:
        admin.execute("delete from ops.worker_heartbeat where worker_id = 'wo0072-test'")


def test_full_cycle_with_fake_image_services(wdb, add_job, admin, user):
    jid = add_job(path=f"{user}/photo.png"); buf = io.BytesIO(); garment_photo().save(buf, format="PNG")
    claimed = wdb.claim()
    w = Worker(wdb, FakeStorage(claimed, buf.getvalue()), FakeRemover(), None, "w-test")
    assert w.process(claimed) == "done"
    status, _, _, result, _ = row(admin, jid)
    assert status == "done" and result["path"] == f"{user}/{jid}-cutout.webp" and result["garment"] is None and len(result["dominant_rgb"]) == 3


def test_error_text_never_reaches_last_error(wdb, add_job, admin):
    jid = add_job(); claimed = wdb.claim()

    class Leaky:
        def signed_urls(self, i):
            raise RuntimeError("password=hunter2 http://x/?token=abc")
    w = Worker(wdb, Leaky(), FakeRemover(), None, "w-test")
    assert w.process(claimed) == "queued"
    assert row(admin, jid)[2] == "handler_error_RuntimeError"
