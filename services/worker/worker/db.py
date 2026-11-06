"""All database access, as the limited role worker_role (LLD 7.1, 7.2). The claim is app.claim_job() (one statement, FOR UPDATE SKIP LOCKED).

Every write that finishes a job adds `status = 'running' and attempts = <claimed attempts>`: if no row changes, the job was reaped or
claimed again and the caller discards its result. last_error holds a fixed code word only, never an exception message.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Callable

import psycopg

MAX_ATTEMPTS = 3
RETRY_SECONDS = 30


@dataclass(frozen=True)
class Job:
    id: int
    user_id: str
    type: str
    input: dict
    attempts: int


class Database:
    def __init__(self, connect: Callable[[], psycopg.Connection]):
        self._connect = connect
        self._conn: psycopg.Connection | None = None

    @classmethod
    def from_url(cls, url: str) -> "Database":
        return cls(lambda: psycopg.connect(url, autocommit=True, connect_timeout=10))

    @property
    def conn(self) -> psycopg.Connection:
        if self._conn is None or self._conn.closed:
            self._conn = self._connect()
        return self._conn

    def close(self) -> None:
        if self._conn is not None and not self._conn.closed:
            self._conn.close()
        self._conn = None

    def claim(self) -> Job | None:
        row = self.conn.execute("select id, user_id::text, type, input, attempts from app.claim_job()").fetchone()
        return Job(row[0], row[1], row[2], row[3], row[4]) if row and row[0] is not None else None

    def succeed(self, job: Job, result: dict) -> bool:
        cur = self.conn.execute(
            "update app.jobs set status = 'done', result = %s::jsonb where id = %s and status = 'running' and attempts = %s",
            (json.dumps(result), job.id, job.attempts))
        return cur.rowcount == 1

    def fail(self, job: Job, code: str) -> bool:
        cur = self.conn.execute(
            "update app.jobs set status = 'failed', last_error = %s where id = %s and status = 'running' and attempts = %s",
            (code[:200], job.id, job.attempts))
        return cur.rowcount == 1

    def retry_or_fail(self, job: Job, code: str) -> str:
        """LLD 7.2: back to queued 30 seconds later while attempts < 3, else failed. Returns 'queued', 'failed' or 'discarded'."""
        if job.attempts >= MAX_ATTEMPTS:
            return "failed" if self.fail(job, code) else "discarded"
        cur = self.conn.execute(
            "update app.jobs set status = 'queued', last_error = %s, run_after = now() + make_interval(secs => %s) "
            "where id = %s and status = 'running' and attempts = %s",
            (code[:200], RETRY_SECONDS, job.id, job.attempts))
        return "queued" if cur.rowcount == 1 else "discarded"

    def heartbeat(self, worker_id: str, version: str) -> None:
        """LLD 7.6: one upsert; queue depth and the age of the oldest queued job in seconds."""
        self.conn.execute(
            "insert into ops.worker_heartbeat (worker_id, seen_at, queue_depth, oldest_queued_age, version) "
            "select %s, now(), count(*)::int, (extract(epoch from now() - min(created_at)))::int, %s from app.jobs where status = 'queued' "
            "on conflict (worker_id) do update set seen_at = excluded.seen_at, queue_depth = excluded.queue_depth, "
            "oldest_queued_age = excluded.oldest_queued_age, version = excluded.version",
            (worker_id, version))
