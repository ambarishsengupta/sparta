"""WO-0120: tests of the H&M demo catalogue loader. Pure tests use the INVENTED fixture articles.csv beside this file (made-up ids 099xxxxxxx, which no real
H&M article uses, and made-up names); the one live test needs SEED_LIVE=1 and the real local folder, and skips cleanly otherwise.
Run: ~/.sparta-venv/bin/python -m pytest workflow/demo/hm/tests -q   (not collected by the gate yet: see WO-0120-NOTES.md)"""
import builtins, json, os, re, subprocess, sys
from pathlib import Path

import pytest

TESTS = Path(__file__).resolve().parent
HM = TESTS.parent
REPO = HM.parents[2]
sys.path.insert(0, str(HM))
sys.dont_write_bytecode = True
import load_hm_demo_catalog as L  # noqa: E402

TAX = json.loads((REPO / "packages/taxonomy/src/taxonomy.json").read_text())
SUBTYPES = {(c["name"], s) for c in TAX["categories"] for s in c["subTypes"]}
FIXTURE_IDS = [r.split(",")[0] for r in (TESTS / "articles.csv").read_text().splitlines()[1:]]


@pytest.fixture
def root(tmp_path):
    """A fake H&M folder: the invented articles.csv plus an empty photo file for every id except the row named 'No Photo'."""
    (tmp_path / "articles.csv").write_text((TESTS / "articles.csv").read_text())
    for line in (TESTS / "articles.csv").read_text().splitlines()[1:]:
        sku, name = line.split(",")[:2]
        if "No Photo" not in name:
            (tmp_path / "images" / sku[:3]).mkdir(parents=True, exist_ok=True)
            (tmp_path / "images" / sku[:3] / f"{sku}.jpg").write_bytes(b"")
    return tmp_path


def test_mapping_uses_only_valid_taxonomy_values_and_covers_the_common_types():
    types, colours = L.load_mapping()
    for t, (cat, sub) in types.items():
        assert (cat, sub) in SUBTYPES, t
    for t in ["Trousers", "Sweater", "T-shirt", "Shirt", "Shorts", "Hoodie", "Jacket", "Blazer", "Polo shirt", "Sneakers", "Socks", "Underwear bottom"]:
        assert t in types
    fams = json.loads((REPO / "jobs/collector/mapping/colour.json").read_text())["families"]
    raw = json.loads((HM / "mapping.json").read_text())["colours"]
    assert all(v is None or v in fams for v in raw.values())
    assert colours["Dark Blue"] == fams["Navy"]["rgb"] and colours["Unknown"] is None


def test_unmapped_types_other_index_groups_and_missing_photos_are_skipped(root):
    rows = L.read_articles(root)
    names = {r["name"] for r in rows}
    assert len(rows) == 20
    assert not names & {"Zzyx Swim", "Zzyx Shades", "Zzyx No Photo", "Zzyx Ladies Trousers 1"}
    assert {r["sku"] for r in rows} <= set(FIXTURE_IDS) and all(re.fullmatch(r"099[0-9]{7}", r["sku"]) for r in rows)


def test_sample_is_even_across_categories_and_deterministic(root):
    rows = L.read_articles(root)
    counts = lambda s: {c: sum(1 for r in s if r["category"] == c) for c in {r["category"] for r in s}}
    s = L.sample(rows, 12)
    assert counts(s) == {"Accessories": 1, "Occasion wear": 1, "Underwear and socks": 2, "Footwear": 2, "Bottoms": 3, "Tops": 3}
    assert L.sample(rows, 12) == s and L.sample(list(reversed(rows)), 12) == s
    assert L.sample(rows, 12, seed=1) != s
    assert len(L.sample(rows, 1000)) == 20 and L.quotas({"a": 1, "b": 9}, 6) == {"a": 1, "b": 5}


def test_sql_keeps_the_leading_zero_escapes_quotes_and_never_invents_price_or_barcode(root):
    sql = L.load_sql(L.sample(L.read_articles(root), 20))
    assert "'0990000001'" in sql and "O''Neil" in sql and "'H&M'" in sql
    assert not re.search(r"\b(gtin|price|currency)\b", sql)
    assert "false, current_date" in sql and "on conflict (source_id, vendor_id, sku) do update" in sql and "status = 'active'" in sql
    assert "'127.0.0.1/hm-demo/" not in sql and "'http://127.0.0.1/hm-demo/0990000001'" in sql
    assert L.REMOVE_SQL.startswith("delete from catalog.sources where name = 'hm-demo'") and "catalog_items" not in L.REMOVE_SQL


def test_json_output_is_compact_complete_and_goes_to_the_ignored_folder(root, tmp_path):
    rows = L.sample(L.read_articles(root), 12)
    out = tmp_path / "out" / "x.json"
    L.write_json(rows, out)
    data = json.loads(out.read_text())
    assert len(data) == 12 and all(re.fullmatch(r"099[0-9]{7}", d[0]) and len(d) == 7 for d in data)
    assert out.read_text().startswith('[["099') and {(d[2], d[3]) for d in data} <= SUBTYPES
    assert all((d[4:] == [None] * 3) or all(isinstance(c, int) and 0 <= c <= 255 for c in d[4:]) for d in data)
    assert L.JSON_OUT.relative_to(REPO).as_posix() == "workflow/demo/hm/out/hm-demo.json"
    assert subprocess.run(["git", "check-ignore", "-q", str(L.JSON_OUT)], cwd=REPO).returncode == 0
    env = {**os.environ, "SPARTA_DATA_ROOT_HM": str(root)}
    bad = subprocess.run([sys.executable, "-B", str(HM / "load_hm_demo_catalog.py"), "--json", "0"], capture_output=True, text=True, env=env, timeout=20)
    assert bad.returncode == 2 and "--json must be between" in bad.stderr


@pytest.mark.parametrize("url", [
    "postgresql://postgres:x@db.example.test:5432/postgres", "postgresql://postgres:x@127.0.0.1:54322/postgres?host=db.example.test",
    "postgresql://postgres@evil.test@127.0.0.1/postgres", "postgresql://postgres:x@127.0.0.1.evil.test:5432/postgres",
    "postgresql://postgres:x@10.0.0.5/postgres", "https://127.0.0.1/postgres", "postgresql://postgres:x@127.0.0.1/postgres\n"])
def test_guard_refuses_non_local_databases_before_reading_anything(url, tmp_path):
    env = {**os.environ, "SPARTA_DATA_ROOT_HM": str(tmp_path / "nothing")}
    r = subprocess.run([sys.executable, "-B", str(HM / "load_hm_demo_catalog.py"), "--db-url", url], capture_output=True, text=True, env=env, timeout=20)
    assert r.returncode == 2 and "refusing to run" in r.stderr
    assert L.check_url(L.DEFAULT_URL) and L.check_url("postgres://u@localhost:5432/db") and L.check_url("postgres://u@[::1]/db")


def test_it_reads_only_inside_the_data_root_and_never_writes(root, monkeypatch):
    seen, real_open = [], builtins.open
    monkeypatch.setattr(builtins, "open", lambda f, *a, **k: (seen.append((str(f), a, k)), real_open(f, *a, **k))[1])
    isfiles, real_is_file = [], Path.is_file
    monkeypatch.setattr(Path, "is_file", lambda self: (isfiles.append(str(self)), real_is_file(self))[1])
    L.read_articles(root)
    assert [p for p, *_ in seen] == [str(root / "articles.csv")] and all(len(a) == 0 and "mode" not in k for _, a, k in seen)
    assert all(p.startswith(str(root / "images")) for p in isfiles)
    src = (HM / "load_hm_demo_catalog.py").read_text()
    assert src.count("write_text") == 1 and "path.write_text(json.dumps(" in src   # WO-0122: the one write is the --json output below
    src = src.replace("path.write_text(json.dumps(", "")
    assert not re.search(r"open\([^)]*(,\s*|mode=)['\"][rbt]*[wax+]|shutil\.(copy|move|rmtree)|os\.(remove|rename|unlink|replace)|write_text|write_bytes|hashlib|\.unlink|\.rename", src)


def test_nothing_from_the_real_h_and_m_data_is_tracked_by_git():
    files = subprocess.run(["git", "ls-files", "-z"], cwd=REPO, capture_output=True, text=True, check=True).stdout.split("\0")[:-1]
    assert not [f for f in files if re.search(r"(^|/)[0-9]{10}\.jpe?g$|(^|/)images/[0-9]{3}/|(^|/)transactions_train|(^|/)customers\.csv$", f)]
    assert {f for f in files if f.endswith("articles.csv")} <= {"workflow/demo/hm/tests/articles.csv"}   # only the invented fixture
    # a real article id is 0 + 1-9 + 8 digits; the invented fixture uses 099 and no real article does. A LIST is 20 or more distinct ids in one tracked file
    # (the five purchase rows already in submissions/D3, legal review item 20, are a known older finding and stay below that line).
    for f in files:
        if f.endswith((".pdf", ".png", ".jpg", ".jpeg", ".woff2", "package-lock.json")) or not (REPO / f).is_file():
            continue
        ids = {m for m in re.findall(r"(?<![0-9A-Za-z-])0[1-9][0-9]{8}(?![0-9A-Za-z-])", (REPO / f).read_text(errors="ignore")) if not m.startswith("099")}
        assert len(ids) < 20, f"{f} holds what looks like a list of H&M article ids"
    for p in ["workflow/demo/hm/out/anything.json", "workflow/local.env"]:
        assert subprocess.run(["git", "check-ignore", "-q", p], cwd=REPO).returncode == 0, p


@pytest.mark.skipif(os.environ.get("SEED_LIVE") != "1", reason="opt-in: SEED_LIVE=1 loads 50 real articles into the LOCAL database and removes them again")
def test_live_load_50_real_articles_is_idempotent_and_removes_cleanly():
    try:
        root = L.data_root()
    except SystemExit:
        pytest.skip("the local H&M folder (SPARTA_DATA_ROOT_HM) is not present")
    sql = lambda q: L.run_sql(q, L.DEFAULT_URL)
    if sql("select count(*) from catalog.sources where name = 'hm-demo'") != "0":
        pytest.skip("the hm-demo source already exists; the live test will not remove someone's loaded catalogue")
    cli = lambda *a: subprocess.run([sys.executable, "-B", str(HM / "load_hm_demo_catalog.py"), *a], capture_output=True, text=True, timeout=120)
    try:
        first = cli("--count", "50")
        assert first.returncode == 0 and "hm-demo items: 50 active" in first.stdout, first.stderr
        check = "select count(*) filter (where sku ~ '^[0-9]{10}$' and brand = 'H&M' and price is null and gtin is null and status = 'active' and category is not null and sub_type is not null), count(*) from catalog.catalog_items i join catalog.sources s on s.id = i.source_id where s.name = 'hm-demo'"
        assert sql(check) == "50|50" and sql("select allowed from catalog.sources where name = 'hm-demo'") == "f"
        assert any(Path(root, "images", s[:3], f"{s}.jpg").is_file() for s in sql("select sku from catalog.catalog_items where product_url like '%hm-demo%' limit 5").split())
        again = cli("--count", "50")
        assert again.stdout == first.stdout and sql(check) == "50|50"
        assert sql("select count(*) from catalog.sources where name = 'hm-demo'") == "1"
    finally:
        assert cli("--remove").returncode == 0
    assert sql("select count(*) from catalog.sources where name = 'hm-demo'") == "0" and "hm-demo items: 0" in cli("--counts").stdout
