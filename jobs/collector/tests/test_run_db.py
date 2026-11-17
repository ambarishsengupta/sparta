"""The run on the REAL local database as collector_role against the local test server (LLD 8.1 steps 1, 6, 7; CC8); each test cleans up."""
import io
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg
import pytest

from collector import __main__ as cli
from collector.run import run_all, run_source
from collector.store import eligible_sources

pytestmark = pytest.mark.db
ROOT = Path(__file__).resolve().parents[1]
NAMES = {"Heavy Cotton T-Shirt", "Slim Chinos", "Wool Blazer", "Mystery Gadget", "Leather Belt"}      # the five products of tests/site


@pytest.fixture
def mksource(admin, site):
    made = []

    def make(allowed=True, down=False, collected_days_ago=None, url=None):
        sid = admin.execute(
            "insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on, takedown_at, last_collected_at) "
            "values (%s, %s, true, 'SYNTHETIC test source', %s, current_date, case when %s then now() end, "
            "now() - make_interval(secs => %s)) returning id",
            (f"wo0087-{uuid.uuid4().hex[:8]}", url or site.base + "/", allowed and not down, down,
             None if collected_days_ago is None else collected_days_ago * 86400)).fetchone()[0]
        made.append(sid)
        return sid
    yield make
    for sid in made:
        admin.execute("delete from catalog.sources where id = %s", (sid,))      # the items go with it (cascade)


def go(cdb, sid, site, clock, **kw):
    return run_source(cdb, sid, site.base + "/", clock=clock, **kw)


def rows(admin, sid):
    return {r[0]: r[1:] for r in admin.execute(
        "select name, status, missed_runs, category, collected_at from catalog.catalog_items where source_id = %s", (sid,))}


def last_collected(admin, sid):
    return admin.execute("select last_collected_at from catalog.sources where id = %s", (sid,)).fetchone()[0]


def urlset(site, *paths):
    return "<urlset>" + "".join(f"<url><loc>{site.base}{p}</loc></url>" for p in paths) + "</urlset>"


def test_first_run_inserts_with_review_rows_unmapped(cdb, admin, site, clock, mksource):
    sid = mksource()
    n = go(cdb, sid, site, clock)
    assert (n["completed"], n["stopped"], n["inserted"], n["updated"], n["review"], n["missed"], n["withdrawn"]) == (True, None, 5, 0, 1, 0, 0)
    assert (n["pages"], n["page_errors"], n["robots_skipped"], n["rejected"]) == (3, 0, 0, 0)      # the sitemap's other-host address was not followed
    got = rows(admin, sid)
    assert set(got) == NAMES and sum(1 for v in got.values() if v[0] == "active") == 4
    assert got["Mystery Gadget"][:3] == ("review", 0, None) and all(v[1] == 0 for v in got.values())
    sub, colour = admin.execute("select sub_type, colour_family from catalog.catalog_items where source_id = %s and name = 'Mystery Gadget'", (sid,)).fetchone()
    assert sub is None and colour is None
    assert admin.execute("select count(*) from catalog.catalog_items where source_id = %s and colour_family is not null and vendor_id is null", (sid,)).fetchone()[0] == 4
    assert last_collected(admin, sid) is not None


def test_second_run_updates_in_place_and_resets_the_counters(cdb, admin, site, clock, mksource):
    sid = mksource()
    go(cdb, sid, site, clock)
    first = rows(admin, sid)
    ids = {r[0] for r in admin.execute("select id from catalog.catalog_items where source_id = %s", (sid,))}
    admin.execute("update catalog.catalog_items set missed_runs = 1, price = 1 where source_id = %s", (sid,))
    n = go(cdb, sid, site, clock)
    assert (n["inserted"], n["updated"], n["missed"]) == (0, 5, 0)
    assert {r[0] for r in admin.execute("select id from catalog.catalog_items where source_id = %s", (sid,))} == ids
    second = rows(admin, sid)
    assert all(v[1] == 0 and v[3] > first[k][3] for k, v in second.items())              # missed_runs back to 0, collected_at moved on
    assert admin.execute("select price from catalog.catalog_items where source_id = %s and name = 'Heavy Cotton T-Shirt'", (sid,)).fetchone()[0] == 24.5


def test_a_removed_page_withdraws_after_two_completed_runs_and_comes_back(cdb, admin, site, clock, mksource):
    sid = mksource()
    go(cdb, sid, site, clock)
    site.set("/products/graph.html", 404)
    n = go(cdb, sid, site, clock)
    assert (n["completed"], n["missed"], n["withdrawn"], n["page_errors"]) == (True, 1, 0, 1)
    assert rows(admin, sid)["Slim Chinos"][:2] == ("active", 1)
    n = go(cdb, sid, site, clock)
    assert (n["missed"], n["withdrawn"]) == (1, 1) and rows(admin, sid)["Slim Chinos"][:2] == ("withdrawn", 2)
    n = go(cdb, sid, site, clock)
    assert (n["missed"], n["withdrawn"]) == (0, 0) and rows(admin, sid)["Slim Chinos"][:2] == ("withdrawn", 2)      # no counting past the withdrawal
    assert all(v[:2] == ("active" if k != "Mystery Gadget" else "review", 0) for k, v in rows(admin, sid).items() if k != "Slim Chinos")
    del site.routes["/products/graph.html"]
    n = go(cdb, sid, site, clock)
    assert n["updated"] == 5 and rows(admin, sid)["Slim Chinos"][:2] == ("active", 0)       # back on the site: active again


def test_a_page_missing_from_the_sitemap_counts_the_same_way(cdb, admin, site, clock, mksource):
    sid = mksource()
    go(cdb, sid, site, clock)
    site.set("/sitemap.xml", 200, urlset(site, "/products/tee.html", "/products/graph.html"))
    n = go(cdb, sid, site, clock)
    assert (n["completed"], n["stopped"], n["updated"], n["missed"]) == (True, None, 2, 3)
    assert {k for k, v in rows(admin, sid).items() if v[1] == 1} == {"Wool Blazer", "Mystery Gadget", "Leather Belt"}


def test_robots_disallow_mid_site_skips_the_page_and_the_run_completes(cdb, admin, site, clock, mksource):
    sid = mksource()
    go(cdb, sid, site, clock)
    before = site.hits["/products/graph.html"]
    site.set("/robots.txt", 200, "User-agent: *\nDisallow: /products/graph.html\n")
    n = go(cdb, sid, site, clock)
    assert site.hits["/products/graph.html"] == before                       # no request for the disallowed page
    assert (n["completed"], n["robots_skipped"], n["updated"], n["missed"]) == (True, 1, 4, 1)
    assert rows(admin, sid)["Slim Chinos"][:2] == ("active", 1)


@pytest.mark.parametrize("fault", ["robots", "repeated", "budget"])
def test_an_early_stop_counts_nothing_and_does_not_set_last_collected_at(fault, cdb, admin, site, clock, mksource):
    sid = mksource()
    go(cdb, sid, site, clock)
    admin.execute("update catalog.sources set last_collected_at = last_collected_at - interval '1 day' where id = %s", (sid,))
    stamp, kw = last_collected(admin, sid), {}
    if fault == "robots":
        site.set("/robots.txt", 500)
    elif fault == "repeated":
        site.set("/products/graph.html", 500)
    else:
        kw = {"budget": 5.0}
    n = go(cdb, sid, site, clock, **kw)
    assert n["completed"] is False and n["stopped"] == {"robots": "robots_unreachable", "repeated": "repeated_errors", "budget": "time_budget"}[fault]
    assert n["missed"] == n["withdrawn"] == 0 and all(v[1] == 0 for v in rows(admin, sid).values())
    assert last_collected(admin, sid) == stamp


@pytest.mark.parametrize("fault,code", [("gone", "sitemap_unavailable"), ("doctype", "xml_refused"), ("empty", "empty_sitemap"), ("robots", "robots_disallowed")])
def test_an_unreadable_sitemap_stops_the_source_instead_of_withdrawing_the_catalogue(fault, code, cdb, admin, site, clock, mksource):
    sid = mksource()
    go(cdb, sid, site, clock)
    bodies = {"gone": (404, ""), "doctype": (200, '<!DOCTYPE x [<!ENTITY a "b">]><urlset/>'), "empty": (200, "<urlset/>"), "robots": (200, "<urlset/>")}
    site.set("/sitemap.xml", *bodies[fault])
    if fault == "robots":
        site.set("/robots.txt", 200, "User-agent: *\nDisallow: /sitemap.xml\n")
    n = go(cdb, sid, site, clock)
    assert (n["completed"], n["stopped"], n["missed"]) == (False, code, 0) and all(v[1] == 0 for v in rows(admin, sid).values())


def test_a_sitemap_index_is_followed_one_level(cdb, admin, site, clock, mksource):
    index = (ROOT / "tests/site/sitemap-index.xml").read_text().replace("{BASE}", site.base).replace("/sitemap.xml", "/sitemap-pages.xml")
    site.set("/sitemap.xml", 200, index)
    site.set("/sitemap-pages.xml", 200, urlset(site, "/products/tee.html"))
    n = go(cdb, mksource(), site, clock)
    assert (n["completed"], n["inserted"]) == (True, 1)
    site.set("/sitemap-pages.xml", 404)                                                # a missing sub-sitemap stops the source too
    assert go(cdb, mksource(), site, clock)["stopped"] == "sitemap_unavailable"


def test_a_row_the_database_refuses_is_counted_and_the_run_goes_on(cdb, admin, site, clock, mksource):
    page = {"@context": "https://schema.org", "@graph": [
        {"@type": "Product", "sku": "BIG", "name": "Wool Blazer", "color": "Navy", "url": f"{site.base}/products/big.html",
         "offers": {"@type": "Offer", "price": "99999999999999", "priceCurrency": "USD"}},
        {"@type": "Product", "sku": "FOREIGN", "name": "Wool Blazer", "color": "Navy", "url": "http://other-shop.example.test/x"},
        {"@type": "Product", "sku": "OK", "name": "Wool Blazer", "color": "Navy", "url": f"{site.base}/products/ok.html"}]}
    site.set("/products/big.html", 200, f'<script type="application/ld+json">{json.dumps(page)}</script>')
    site.set("/sitemap.xml", 200, urlset(site, "/products/big.html"))
    sid = mksource()
    n = go(cdb, sid, site, clock)
    assert (n["completed"], n["inserted"], n["rejected"]) == (True, 1, 1)
    assert admin.execute("select sku from catalog.catalog_items where source_id = %s", (sid,)).fetchall() == [("OK",)]       # the other-host record was dropped


def test_review_work_by_an_admin_survives_the_next_run(cdb, admin, site, clock, mksource):
    sid = mksource()
    go(cdb, sid, site, clock)
    admin.execute("update catalog.catalog_items set status = 'active', category = 'accessories', sub_type = 'belt' where source_id = %s and name = 'Mystery Gadget'", (sid,))
    admin.execute("update catalog.catalog_items set status = 'withdrawn' where source_id = %s and name = 'Wool Blazer'", (sid,))
    n = go(cdb, sid, site, clock)
    assert n["review"] == 1                                                              # the collector still sees it as unmapped
    assert admin.execute("select status, category, sub_type from catalog.catalog_items where source_id = %s and name = 'Mystery Gadget'", (sid,)).fetchone() == ("active", "accessories", "belt")
    assert rows(admin, sid)["Wool Blazer"][:2] == ("active", 0)                         # a withdrawn row that reappears with a mapping is active again


def test_a_withdrawn_row_that_reappears_unmapped_goes_back_to_review(cdb, admin, site, clock, mksource):
    sid = mksource()
    go(cdb, sid, site, clock)
    admin.execute("update catalog.catalog_items set status = 'withdrawn', missed_runs = 2 where source_id = %s and name = 'Mystery Gadget'", (sid,))
    go(cdb, sid, site, clock)
    assert rows(admin, sid)["Mystery Gadget"][:3] == ("review", 0, None)


# ---- which sources are collected ---------------------------------------------------------------------------------------------------
def test_allowed_false_and_taken_down_sources_are_never_selected_or_fetched(cdb, admin, site, clock, mksource):
    off, down = mksource(allowed=False), mksource(down=True)
    ok = mksource()
    ids = {i for i, _ in eligible_sources(cdb)}
    assert not ({off, down} & ids) and ok in ids
    for sid in (off, down):
        assert run_all(cdb, only=sid, clock=clock) == [] and eligible_sources(cdb, only=sid) == []         # --source does not override
    assert site.hits == {} and site.agents == []                                          # nothing, not even robots.txt, was requested
    n = go(cdb, off, site, clock)                                                         # a forced run for a source that is not allowed writes no row
    assert (n["completed"], n["stopped"], n["inserted"]) == (False, "source_not_allowed", 0) and rows(admin, off) == {}


def test_the_six_day_skip(cdb, admin, site, clock, mksource):
    recent, old, never = mksource(collected_days_ago=5.9), mksource(collected_days_ago=6.1), mksource()
    ids = {i for i, _ in eligible_sources(cdb)}
    assert recent not in ids and old in ids and never in ids
    assert run_all(cdb, only=recent, clock=clock) == [] and site.hits == {}
    ((sid, n),) = run_all(cdb, only=old, clock=clock)
    assert sid == old and n["completed"] and eligible_sources(cdb, only=old) == []        # collected now: skipped for the next six days


def test_take_down_then_run_collects_nothing(cdb, admin, site, clock, mksource):
    sid = mksource()
    assert go(cdb, sid, site, clock)["inserted"] == 5
    admin.execute("update catalog.sources set allowed = false, takedown_at = now() where id = %s", (sid,))       # what catalog.take_down_source does ...
    assert admin.execute("delete from catalog.catalog_items where source_id = %s", (sid,)).rowcount == 5          # ... plus the delete
    site.hits.clear()
    assert run_all(cdb, only=sid, clock=clock) == [] and sid not in {i for i, _ in eligible_sources(cdb)} and site.hits == {}
    n = go(cdb, sid, site, clock)                                                         # even a forced run cannot write a row for it
    assert (n["completed"], n["stopped"], n["inserted"]) == (False, "source_not_allowed", 0) and rows(admin, sid) == {}


def test_a_take_down_in_the_middle_of_a_run_stops_it_and_leaves_no_row(cdb, admin, site, clock, mksource):
    sid = mksource()
    body = site.page("products/graph.html").encode()

    def takedown(_hit):
        admin.execute("update catalog.sources set allowed = false, takedown_at = now() where id = %s", (sid,))
        admin.execute("delete from catalog.catalog_items where source_id = %s", (sid,))
        return 200, {}, body
    site.routes["/products/graph.html"] = takedown
    n = go(cdb, sid, site, clock)
    assert (n["completed"], n["stopped"], n["inserted"]) == (False, "source_not_allowed", 1) and rows(admin, sid) == {}


def test_a_source_on_a_live_host_is_refused_without_any_lookup(cdb, admin, site, clock, mksource, net):
    sid = mksource(url="https://shop.example.test/")
    ((_, n),) = run_all(cdb, only=sid, clock=clock)
    assert (n["completed"], n["stopped"], n["pages"]) == (False, "live_collection_disabled", 0)
    assert "shop.example.test" not in net and site.hits == {}


def test_vendor_rows_are_never_touched_or_visible(cdb, admin, site, clock, mksource):
    vid = admin.execute("insert into catalog.vendors (name) values (%s) returning id", (f"wo0087-vendor-{uuid.uuid4().hex[:8]}",)).fetchone()[0]
    try:
        admin.execute("insert into catalog.catalog_items (vendor_id, sku, name, product_url, status, category, sub_type, missed_runs) "
                      "values (%s, 'ZV-TEE-01', 'Vendor tee', 'https://v.example.test/t', 'active', 'tops', 't_shirt', 1)", (vid,))
        q = "select id, status, missed_runs, collected_at, name, price from catalog.catalog_items where vendor_id = %s"
        before = admin.execute(q, (vid,)).fetchall()
        sid = mksource()
        for _ in range(3):
            go(cdb, sid, site, clock)
            site.set("/products/tee.html", 404)         # the collected row of the same sku goes missing; the vendor row must not follow
        assert admin.execute(q, (vid,)).fetchall() == before
        assert rows(admin, sid)["Heavy Cotton T-Shirt"][:2] == ("withdrawn", 2)
        assert cdb.execute("select count(*) from catalog.catalog_items where vendor_id is not null").fetchone()[0] == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cdb.execute("select * from catalog.vendors")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cdb.execute("select * from app.items")
    finally:
        admin.execute("delete from catalog.vendors where id = %s", (vid,))


def test_the_collector_cannot_delete_or_write_outside_its_grants(cdb, admin, site, clock, mksource):
    sid = mksource()
    go(cdb, sid, site, clock)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        cdb.execute("delete from catalog.catalog_items where source_id = %s", (sid,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        cdb.execute("update catalog.sources set allowed = true where id = %s", (sid,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        cdb.execute("insert into catalog.sources (name, site_url, robots_allowed, terms_note, checked_on) values ('x', 'http://127.0.0.1/', true, 'x', current_date)")


# ---- the command line ---------------------------------------------------------------------------------------------------------------
def test_cli_prints_counts_only(cdb, admin, site, clock, mksource, collector_url, monkeypatch):
    monkeypatch.delenv("COLLECTOR_REPO_URL", raising=False)
    sid, other = mksource(), mksource()
    out = io.StringIO()
    assert cli.main(["run", "--source", str(sid)], env={"COLLECTOR_DATABASE_URL": collector_url, "COLLECTOR_REPO_URL": "https://repo.example.test/y"}, clock=clock, out=out) == 0
    text = out.getvalue()
    assert f"source {sid}: completed pages=3 inserted=5 updated=0 review=1" in text and "sources run: 1" in text
    assert set(site.agents) == {"SpartaPilotBot/0.1 (+https://repo.example.test/y)"}      # the repository URL travels CLI -> run -> fetcher
    assert site.hits["/robots.txt"] == 1 and rows(admin, other) == {}                    # --source narrows the run to that one source
    for leak in ("Zorvane", "Heavy", "Chinos", "Blazer", "Gadget", "ZV-TEE", "127.0.0.1", "http", collector_url.split(":")[2].split("@")[0]):
        assert leak not in text


def test_cli_refuses_a_session_that_is_not_collector_role(admin, capsys):
    from conftest import ADMIN_URL
    out = io.StringIO()
    assert cli.main(["run"], env={"COLLECTOR_DATABASE_URL": ADMIN_URL}, out=out) == 2 and out.getvalue() == ""
    assert "wrong_database_role" in capsys.readouterr().err


def test_python_dash_m_collector_run_end_to_end_with_the_real_clock(admin, site, mksource, collector_url):
    site.set("/sitemap.xml", 200, urlset(site, "/products/tee.html"))
    sid = mksource()
    done = subprocess.run([sys.executable, "-m", "collector", "run", "--source", str(sid)], cwd=ROOT, capture_output=True, text=True, timeout=60,
                          env={**os.environ, "COLLECTOR_DATABASE_URL": collector_url, "COLLECTOR_REPO_URL": "https://repo.example.test/x", "PYTHONDONTWRITEBYTECODE": "1"})
    assert done.returncode == 0, done.stderr
    assert f"source {sid}: completed pages=1 inserted=1" in done.stdout and "Heavy" not in done.stdout + done.stderr
    assert site.agents and set(site.agents) == {"SpartaPilotBot/0.1 (+https://repo.example.test/x)"}          # the exact user agent, repository URL from the env
