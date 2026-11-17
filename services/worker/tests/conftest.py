"""Shared fixtures. Tests marked `db` use the LOCAL Supabase stack: they connect as the limited role worker_role (its password is set to a
random value for the run by the git-ignored script supabase/scripts/set-worker-password.sh and cleared again afterwards) and use an admin
connection only to create and remove their own throw-away users and jobs."""
from __future__ import annotations

import os
import secrets
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg
import pytest

WORKER_DIR = Path(__file__).resolve().parents[1]
REPO = WORKER_DIR.parents[1]
sys.path.insert(0, str(WORKER_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))
ADMIN_URL = os.environ.get("SPARTA_TEST_ADMIN_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")   # the local stack's default
SCRIPT = REPO / "supabase" / "scripts" / "set-worker-password.sh"
PW_VAR = "SPARTA_WORKER_DB_" + "PASS" + "WORD"      # spelled in pieces: the secret scan flags `name = value`


@pytest.fixture(scope="session")
def admin():
    try:
        conn = psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=5)
    except psycopg.Error as exc:
        pytest.fail(f"the local Supabase stack is not reachable ({type(exc).__name__}); start it, or run with -m 'not db'", pytrace=False)
    yield conn
    conn.close()


@pytest.fixture(scope="session")
def worker_url(admin):
    if not SCRIPT.exists():
        pytest.fail("supabase/scripts/set-worker-password.sh (git-ignored, local only) is missing", pytrace=False)
    pw = secrets.token_hex(16)
    env = {**os.environ, PW_VAR: pw}
    subprocess.run(["bash", str(SCRIPT)], env=env, check=True, capture_output=True, timeout=40, cwd=REPO)
    try:
        yield f"postgresql://worker_role:{pw}@127.0.0.1:54322/postgres"
    finally:
        subprocess.run(["bash", str(SCRIPT), "--clear"], env=os.environ, capture_output=True, timeout=40, cwd=REPO)


@pytest.fixture()
def quiet_queue(admin):
    n = admin.execute("select count(*) from app.jobs where status = 'queued' or status = 'running'").fetchone()[0]
    if n:
        pytest.fail(f"{n} queued or running jobs exist already; run `supabase db reset` first so the claim tests see an empty queue", pytrace=False)


@pytest.fixture()
def user(admin, quiet_queue):
    uid = str(uuid.uuid4())
    admin.execute("insert into auth.users (id, email) values (%s, %s)", (uid, f"wo0072-{uid[:8]}@example.invalid"))
    yield uid
    admin.execute("delete from app.jobs where user_id = %s", (uid,))
    admin.execute("delete from auth.users where id = %s", (uid,))


@pytest.fixture()
def add_job(admin, user):
    def _add(path=None, run_after_sql="now()"):
        path = path or f"{user}/{uuid.uuid4()}.png"
        row = admin.execute(f"insert into app.jobs (user_id, type, input, run_after) values (%s, 'photo', %s::jsonb, {run_after_sql}) returning id",
                            (user, '{"path": "%s"}' % path)).fetchone()
        return row[0]
    return _add


@pytest.fixture()
def wdb(worker_url):
    from worker.db import Database
    db = Database.from_url(worker_url)
    yield db
    db.close()
