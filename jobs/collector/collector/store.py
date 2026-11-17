"""Storage as the limited role collector_role (LLD 8.1 steps 1, 6, 7; WO-0083 grants). No password and no key lives here: the connection
string comes from COLLECTOR_DATABASE_URL. The connection is refused unless it goes to a loopback database (unless COLLECTOR_LIVE=1) and
unless the session really is collector_role (never a superuser or the secret key)."""
from __future__ import annotations

import os

import psycopg
from psycopg.conninfo import conninfo_to_dict

from .fetcher import LOOPBACK_HOSTS, CollectorError

SKIP_DAYS = 6          # a source collected within this many days is skipped (LLD 8.1 step 1, Policy section 6)
WITHDRAW_AT = 2        # missed runs in a row that withdraw a row (LLD 8.1 step 6)

# column -> SQL type of the parameter (explicit casts: the values arrive through INSERT ... SELECT)
COLS = {"sku": "text", "name": "text", "brand": "text", "gtin": "text", "category": "text", "sub_type": "text", "colour_r": "smallint",
        "colour_g": "smallint", "colour_b": "smallint", "is_multicolour": "boolean", "sizes_available": "text[]", "price": "numeric",
        "currency": "text", "product_url": "text", "status": "text"}
_KEEP_OLD = ("category", "sub_type")      # a value an admin filled in during review is not wiped by a run that could not map it
_PLAIN = [c for c in COLS if c not in _KEEP_OLD and c not in ("sku", "status")]
UPSERT = (
    "insert into catalog.catalog_items (source_id, vendor_id, " + ", ".join(COLS) + ", collected_at, missed_runs) "
    "select s.id, null::uuid, " + ", ".join(f"%({c})s::{t}" for c, t in COLS.items()) + ", now(), 0 "
    "from catalog.sources s where s.id = %(source_id)s and s.allowed and s.takedown_at is null for share of s "    # a source taken down mid-run gets no row
    "on conflict (source_id, vendor_id, sku) do update set "
    + ", ".join(f"{c} = excluded.{c}" for c in _PLAIN) + ", "
    + ", ".join(f"{c} = coalesce(excluded.{c}, catalog.catalog_items.{c})" for c in _KEEP_OLD) + ", "
    "status = case when excluded.status = 'active' then 'active' when catalog.catalog_items.status = 'withdrawn' then excluded.status "
    "else catalog.catalog_items.status end, collected_at = now(), missed_runs = 0 "
    "returning id, (xmax = 0)")


def check_db_url(url: str) -> None:
    """Refuses a database that is not on this machine before any connection is made (the host AND hostaddr, in the URL or the environment)."""
    try:
        info = conninfo_to_dict(url)
    except psycopg.Error:
        raise CollectorError("bad_database_url") from None
    if os.environ.get("COLLECTOR_LIVE") == "1":
        return
    addrs = [info.get("hostaddr") or os.environ.get("PGHOSTADDR")]
    if not info.get("host") or any(h not in LOOPBACK_HOSTS for h in [info["host"]] + [a for a in addrs if a]):
        raise CollectorError("database_not_local")


def connect(url: str):
    check_db_url(url)
    conn = psycopg.connect(url, autocommit=True, connect_timeout=10, application_name="sparta-collector")
    if conn.execute("select current_user").fetchone()[0] != "collector_role":
        conn.close()
        raise CollectorError("wrong_database_role")
    return conn


def eligible_sources(conn, only: int | None = None) -> list[tuple[int, str]]:
    """(id, site_url) of sources that are allowed, not taken down and not collected in the last SKIP_DAYS days. `only` narrows, never widens."""
    sql = ("select id, site_url from catalog.sources where allowed and takedown_at is null "
           "and (last_collected_at is null or last_collected_at <= now() - make_interval(days => %s))")
    args = [SKIP_DAYS]
    if only is not None:
        sql, args = sql + " and id = %s", args + [only]
    return conn.execute(sql + " order by id", args).fetchall()


def upsert_item(conn, source_id: int, row: dict):
    """(id, inserted) of the row written, or None when the source is no longer allowed (taken down while the run was going)."""
    return conn.execute(UPSERT, {**{c: row.get(c) for c in COLS}, "source_id": source_id}).fetchone()


def finish_source(conn, source_id: int, seen: set) -> tuple[int, int]:
    """A COMPLETED run: rows of this source not seen get missed_runs + 1, those reaching WITHDRAW_AT are withdrawn, last_collected_at is set.
    Returns (missed, withdrawn). Rows of vendors (vendor_id not null) are never selected here, and the role cannot see them anyway."""
    with conn.transaction():
        rows = conn.execute(
            "update catalog.catalog_items set missed_runs = missed_runs + 1, "
            "status = case when missed_runs + 1 >= %s then 'withdrawn' else status end "
            "where source_id = %s and vendor_id is null and status <> 'withdrawn' and not (id = any(%s::uuid[])) returning status",
            (WITHDRAW_AT, source_id, list(seen))).fetchall()
        conn.execute("update catalog.sources set last_collected_at = now() where id = %s", (source_id,))
    return len(rows), sum(1 for (s,) in rows if s == "withdrawn")
