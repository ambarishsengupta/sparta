"""The run (LLD 8.1 steps 1, 2, 6, 7): per eligible source fetch the sitemap and product pages (WO-0086 pipeline), upsert, and only when the run
COMPLETED count missed runs and set last_collected_at. Any early stop (SourceStopped, time budget, unreadable sitemap, take-down) counts nothing."""
from __future__ import annotations

import psycopg
from urllib.parse import urljoin

from .extract import extract_products, parse_sitemap, same_site
from .fetcher import CollectorError, Fetcher, RobotsDisallowed, SourceStopped
from .mapping import map_record
from .store import eligible_sources, finish_source, upsert_item

DEFAULT_BUDGET = 900.0     # seconds per source (WO-0086 note: the fetcher bounds bytes and each request, not the whole source)
MAX_SITEMAPS = 20
MAX_PAGES = 5000


def _get(fetcher, url, deadline):
    if fetcher.clock.monotonic() > deadline:
        raise SourceStopped("time_budget")
    return fetcher.fetch(url)


def _page_urls(fetcher, site_url, deadline):
    """Product page addresses from the sitemap (an index is followed one level). Every sitemap must be read: a missing one would make the
    rest of the catalogue look removed, so any failure here stops the source instead (and counts nothing)."""
    def read(url):
        try:
            resp = _get(fetcher, url, deadline)
            if resp.status != 200:
                raise SourceStopped("sitemap_unavailable")
            return parse_sitemap(resp.body)
        except SourceStopped:
            raise
        except CollectorError as err:
            raise SourceStopped(err.code) from None

    top = read(urljoin(site_url, "/sitemap.xml"))
    locs = top.locs
    if top.kind == "sitemapindex":
        locs = []
        for loc in same_site(top.locs, site_url)[:MAX_SITEMAPS]:
            sub = read(loc)
            locs += sub.locs if sub.kind == "urlset" else []
    urls = list(dict.fromkeys(same_site(locs, site_url)))[:MAX_PAGES]
    if not urls:
        raise SourceStopped("empty_sitemap")
    return urls


def run_source(conn, source_id: int, site_url: str, clock=None, budget: float = DEFAULT_BUDGET, repo_url=None) -> dict:
    fetcher = Fetcher(clock=clock, repo_url=repo_url)
    deadline = fetcher.clock.monotonic() + budget
    n = {"pages": 0, "inserted": 0, "updated": 0, "review": 0, "robots_skipped": 0, "page_errors": 0, "rejected": 0,
         "missed": 0, "withdrawn": 0, "completed": False, "stopped": None}
    seen: set = set()
    try:
        urls = _page_urls(fetcher, site_url, deadline)
        for url in urls:
            try:
                resp = _get(fetcher, url, deadline)
            except RobotsDisallowed:
                n["robots_skipped"] += 1
                continue
            except SourceStopped:
                raise
            except CollectorError:
                n["page_errors"] += 1
                continue
            n["pages"] += 1
            if resp.status != 200:
                n["page_errors"] += 1
                continue
            for rec in extract_products(resp.body.decode("utf-8", "replace"), url):
                if not same_site([rec["product_url"]], site_url):
                    continue      # a link to another host is never stored for this source
                row = map_record(rec)
                try:
                    out = upsert_item(conn, source_id, row)
                except (psycopg.errors.IntegrityError, psycopg.errors.DataError):
                    n["rejected"] += 1      # the database refused this one row (a check constraint); the run goes on
                    continue
                if out is None:
                    raise SourceStopped("source_not_allowed")
                seen.add(out[0])
                n["inserted" if out[1] else "updated"] += 1
                n["review"] += row["status"] == "review"
        n["completed"] = True
    except SourceStopped as stop:
        n["stopped"] = stop.code
        n["completed"] = stop.counts_missed_run      # False for every stop today: an early stop is not a missed run
    n["log"] = fetcher.log
    if n["completed"]:
        n["missed"], n["withdrawn"] = finish_source(conn, source_id, seen)
    return n


def run_all(conn, only: int | None = None, clock=None, budget: float = DEFAULT_BUDGET, repo_url=None) -> list[tuple[int, dict]]:
    """Every eligible source in turn. `only` narrows to one source and never overrides allowed, take-down or the 6-day skip."""
    out = []
    for source_id, site_url in eligible_sources(conn, only):
        out.append((source_id, run_source(conn, source_id, site_url, clock, budget, repo_url)))
    return out
