#!/usr/bin/env python3
"""LOCAL DEMO ONLY (WO-0120). Loads H&M men's articles from the local folder $SPARTA_DATA_ROOT_HM into the LOCAL database as one catalogue source
named `hm-demo` (allowed = false, so the collector never selects it). READ-ONLY on that folder: it opens articles.csv and checks that single photo files
exist; it copies, hashes and keeps nothing of it, and nothing H&M-derived is ever committed (only `--json` writes rows, into the git-ignored out/ folder).
  ~/.sparta-venv/bin/python workflow/demo/hm/load_hm_demo_catalog.py [--count N] [--db-url URL]   (default 1500; idempotent)
  ... --remove   deletes only the hm-demo source and its items      ... --counts   prints what is loaded
  ... --json [N] (WO-0122) writes N (default 200) articles as compact JSON to workflow/demo/hm/out/hm-demo.json (git-ignored) for the no-login demo; no database
The URL (or SPARTA_DEMO_DB_URL) is REFUSED unless its host is 127.0.0.1, localhost or [::1]. Uses psql if installed, else `docker exec` into the local stack."""
import argparse, csv, json, os, random, re, shutil, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
SOURCE, SEED = "hm-demo", 20261112
ID_RE = re.compile(r"[0-9]{10}")
URL_RE = re.compile(r"postgres(ql)?://[^@/?#\s]*@(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?/[A-Za-z0-9_]+")
DEFAULT_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
NOTE = "H&M course demo data, private, see legal/HM-DEMO-DECISION.md"


def die(msg):
    print(f"hm-demo loader: {msg}", file=sys.stderr)
    sys.exit(2)


def check_url(url):
    if not URL_RE.fullmatch(url):
        die("refusing to run: the database URL must point at 127.0.0.1, localhost or [::1] (no query string).")
    return url


def data_root():
    root = os.environ.get("SPARTA_DATA_ROOT_HM")
    env = REPO / "workflow" / "local.env"
    if not root and env.is_file():
        m = re.search(r"^SPARTA_DATA_ROOT_HM=(.+)$", env.read_text(), re.M)
        root = m.group(1).strip() if m else None
    if not root or not Path(root, "articles.csv").is_file():
        die("SPARTA_DATA_ROOT_HM is not set or has no articles.csv (the H&M folder is local only).")
    return Path(root)


def load_mapping():
    m = json.loads((HERE / "mapping.json").read_text())
    fam = json.loads((REPO / "jobs/collector/mapping/colour.json").read_text())["families"]
    return m["types"], {k: (fam[v]["rgb"] if v else None) for k, v in m["colours"].items()}


def read_articles(root):
    """Menswear rows of a mapped type, with a photo file, as dicts. Photo path: images/<first three digits>/<id>.jpg, built from the id only."""
    types, colours = load_mapping()
    out = []
    with open(root / "articles.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            sku, name = r["article_id"], re.sub(r"[\x00-\x1f]", " ", r["prod_name"]).strip()
            if r["index_group_name"] != "Menswear" or r["product_type_name"] not in types or not name or not ID_RE.fullmatch(sku):
                continue
            if not (root / "images" / sku[:3] / f"{sku}.jpg").is_file():
                continue
            cat, sub = types[r["product_type_name"]]
            out.append({"sku": sku, "name": name, "category": cat, "sub_type": sub, "rgb": colours.get(r["colour_group_name"])})
    return out


def quotas(available, n):
    """Even split of n over the categories; a small category gives its unused share to the larger ones."""
    left, out = n, {}
    for i, (cat, avail) in enumerate(sorted(available.items(), key=lambda kv: (kv[1], kv[0]))):
        out[cat] = min(avail, left // (len(available) - i))
        left -= out[cat]
    return out


def sample(rows, n, seed=SEED):
    by_cat = {}
    for r in sorted(rows, key=lambda r: r["sku"]):
        by_cat.setdefault(r["category"], []).append(r)
    chosen = []
    for cat, q in quotas({c: len(v) for c, v in by_cat.items()}, n).items():
        pool = by_cat[cat]
        random.Random(f"{seed}:{cat}").shuffle(pool)
        chosen += pool[:q]
    return sorted(chosen, key=lambda r: r["sku"])


JSON_OUT = HERE / "out" / "hm-demo.json"


def write_json(rows, path=JSON_OUT):
    """Compact `[[sku, name, category, sub_type, r, g, b], ...]` (r, g, b are null when the article has no colour); the folder is git-ignored."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([[r["sku"], r["name"], r["category"], r["sub_type"], *(r["rgb"] or [None] * 3)] for r in rows], separators=(",", ":"), ensure_ascii=False))


def lit(s):
    return "'" + s.replace("'", "''") + "'"


def load_sql(rows):
    vals = ",\n".join(
        f"({lit(r['sku'])}, {lit(r['name'])}, 'H&M', {lit(r['category'])}, {lit(r['sub_type'])}, "
        + ", ".join(str(c) for c in (r["rgb"] or ["null"] * 3)) + f", {lit('http://127.0.0.1/hm-demo/' + r['sku'])})" for r in rows)
    skus = ", ".join(lit(r["sku"]) for r in rows)
    return f"""begin;
insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on)
select '{SOURCE}', 'http://127.0.0.1/', false, {lit(NOTE)}, false, current_date
where not exists (select 1 from catalog.sources where name = '{SOURCE}' and site_url = 'http://127.0.0.1/');
with src as (select id from catalog.sources where name = '{SOURCE}' and site_url = 'http://127.0.0.1/'), v(sku, name, brand, category, sub_type, r, g, b, url) as (values
{vals})
insert into catalog.catalog_items (source_id, sku, name, brand, category, sub_type, colour_r, colour_g, colour_b, product_url, status, missed_runs)
select src.id, v.sku, v.name, v.brand, v.category, v.sub_type, v.r::smallint, v.g::smallint, v.b::smallint, v.url, 'active', 0 from src, v
on conflict (source_id, vendor_id, sku) do update set name = excluded.name, brand = excluded.brand, category = excluded.category, sub_type = excluded.sub_type,
  colour_r = excluded.colour_r, colour_g = excluded.colour_g, colour_b = excluded.colour_b, product_url = excluded.product_url, status = 'active', missed_runs = 0;
delete from catalog.catalog_items where source_id in (select id from catalog.sources where name = '{SOURCE}' and site_url = 'http://127.0.0.1/') and sku <> all (array[{skus}]);
commit;
"""


REMOVE_SQL = f"delete from catalog.sources where name = '{SOURCE}' and site_url = 'http://127.0.0.1/'; select 'hm-demo source and its items removed';"
COUNTS_SQL = f"""select 'hm-demo items: ' || count(*) || ' active' from catalog.catalog_items i join catalog.sources s on s.id = i.source_id where s.name = '{SOURCE}' and i.status = 'active';
select 'hm-demo ' || coalesce(i.category, '-') || ': ' || count(*) from catalog.catalog_items i join catalog.sources s on s.id = i.source_id where s.name = '{SOURCE}' group by i.category order by i.category;"""


def run_sql(sql, url):
    if shutil.which("psql"):
        cmd = ["psql", url, "-v", "ON_ERROR_STOP=1", "-q", "-At"]
    else:
        m = re.search(r'^project_id *= *"([^"]*)"', (REPO / "supabase/config.toml").read_text(), re.M)
        cmd = ["docker", "exec", "-i", f"supabase_db_{m.group(1) if m else 'sparta'}", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-At"]
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=60)
    if r.returncode:
        die(f"the database refused the statement: {r.stderr.strip()[:500]}")
    return r.stdout.strip()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--count", type=int, default=1500)
    ap.add_argument("--remove", action="store_true")
    ap.add_argument("--counts", action="store_true")
    ap.add_argument("--json", nargs="?", type=int, const=200, default=None, metavar="N")
    ap.add_argument("--db-url", default=os.environ.get("SPARTA_DEMO_DB_URL", DEFAULT_URL))
    a = ap.parse_args(argv)
    url = check_url(a.db_url)   # before anything is read
    if a.json is not None:
        if not 1 <= a.json <= 2000:
            die("--json must be between 1 and 2000.")
        chosen = sample(read_articles(data_root()), a.json)
        if not chosen:
            die("no menswear article of a mapped type with a photo was found.")
        write_json(chosen)
        print(f"wrote {len(chosen)} articles to workflow/demo/hm/out/hm-demo.json")
        return
    if a.remove or a.counts:
        print(run_sql(REMOVE_SQL if a.remove else COUNTS_SQL, url))
        return
    if not 1 <= a.count <= 20000:
        die("--count must be between 1 and 20000.")
    rows = read_articles(data_root())
    chosen = sample(rows, a.count)
    if not chosen:
        die("no menswear article of a mapped type with a photo was found.")
    run_sql(load_sql(chosen), url)
    print(run_sql(COUNTS_SQL, url))


if __name__ == "__main__":
    main()
