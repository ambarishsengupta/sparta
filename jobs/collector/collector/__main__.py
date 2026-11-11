"""`python -m collector run [--source ID]` against COLLECTOR_DATABASE_URL (collector_role, loopback only unless COLLECTOR_LIVE=1). Prints counts and fixed codes only."""
from __future__ import annotations

import argparse
import os
import sys

import psycopg

from .fetcher import CollectorError
from .run import run_all
from .store import connect

COUNTS = ("pages", "inserted", "updated", "review", "robots_skipped", "page_errors", "rejected", "missed", "withdrawn")


def main(argv=None, env=None, clock=None, out=None) -> int:
    out, env = out or sys.stdout, os.environ if env is None else env
    parser = argparse.ArgumentParser(prog="collector")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run", help="collect every eligible source").add_argument("--source", type=int, help="only this source id")
    args = parser.parse_args(argv)
    url = env.get("COLLECTOR_DATABASE_URL")
    if not url:
        print("collector: COLLECTOR_DATABASE_URL is not set", file=sys.stderr)
        return 2
    try:
        conn = connect(url)
    except CollectorError as err:
        print(f"collector: {err.code}", file=sys.stderr)
        return 2
    except psycopg.Error as err:
        print(f"collector: database_unreachable ({type(err).__name__})", file=sys.stderr)
        return 2
    with conn:
        results = run_all(conn, args.source, clock=clock, repo_url=env.get("COLLECTOR_REPO_URL"))
    for source_id, n in results:
        state = "completed" if n["completed"] else "stopped:" + str(n["stopped"])
        print(f"source {source_id}: {state} " + " ".join(f"{k}={n[k]}" for k in COUNTS), file=out)
    print(f"sources run: {len(results)}", file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
