"""Pairing prior: mapping, cleaning, basket pairs, lift scores and JSON output (LLD 7.9, FDD 14.2, 14.5).

Everything here works on DataFrames and arrays, so the unit tests run on synthetic data. No function
writes an H&M row anywhere. Only pandas, numpy and the standard library are used.

Definitions (LLD 7.9, with the readings this file fixes):
  * A basket is one customer's lines on one date.
  * A pair is two distinct articles of one basket in different slots, counted once per basket whatever
    the quantity. The slot pairs are the four the outfit score uses: Top+Bottom, Top+Footwear,
    Bottom+Footwear and Layer+Top (the first slot of the name is the first item of the pair).
  * lift(a, b) = (n_ab + 5) / (E_ab + 5), with E_ab = n_a * n_b / N the expected count, computed inside
    one slot pair (N pairs, n_a pairs whose first item is a, n_b pairs whose second item is b).
    Colour pairs use the same formula on colour families, again inside the slot pair.
  * A type pair or colour pair seen in fewer than 30 baskets has ln lift 0 (neutral).
  * The file stores, per slot pair, sigmoid(clip(ln lift, -2, 2)) for each table; 0.5 is neutral. The
    engine scores a pair of items as sigmoid(logit(type value) + logit(colour value)), which is exactly
    sigmoid(clip(ln lift_type) + clip(ln lift_colour)) of LLD 7.9. A missing entry is neutral (0.5).
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
GARMENT_V2 = HERE.parent / "garment_v2"

SLOTS = ("Top", "Bottom", "Layer", "Footwear")
SLOT_PAIRS = (("Top", "Bottom"), ("Top", "Footwear"), ("Bottom", "Footwear"), ("Layer", "Top"))
SLOT_PAIR_NAMES = tuple(f"{a}+{b}" for a, b in SLOT_PAIRS)
SMOOTHING = 5.0
MIN_BASKETS = 30
LN_CLIP = 2.0
TEST_DAYS = 56          # the last eight weeks of the data
MIN_AGE = 18
PRIOR_VERSION = 1
MAX_UNLOCK = 40
DATE_SPAN = 1 << 20     # basket key = customer * DATE_SPAN + date (days since 1970-01-01)
MENSWEAR = "Menswear"


# ---------------------------------------------------------------- repository files

def repo_root(start=None):
    """The folder that holds packages/taxonomy/src/taxonomy.json, found by walking up from this file."""
    here = Path(start if start is not None else __file__).resolve()
    for folder in [here] + list(here.parents):
        if (folder / "packages" / "taxonomy" / "src" / "taxonomy.json").is_file():
            return folder
    raise FileNotFoundError("packages/taxonomy/src/taxonomy.json not found above " + str(here))


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_taxonomy(root=None):
    """Return (sub_types, colour_families, slots_by_sub_type) from packages/taxonomy (read-only)."""
    base = Path(root) if root else repo_root()
    tax = load_json(base / "packages" / "taxonomy" / "src" / "taxonomy.json")
    slots = load_json(base / "packages" / "taxonomy" / "src" / "slots.json")
    sub_types = {st for cat in tax["categories"] for st in cat["subTypes"]}
    colours = [c["family"] for c in tax["colourFamilies"]]
    category_of = {st: cat["name"] for cat in tax["categories"] for st in cat["subTypes"]}
    slots_of = {}
    for group in slots["groups"]:
        for member in group["members"]:
            names = next(c["subTypes"] for c in tax["categories"] if c["name"] == member["category"]) \
                if member["subTypes"] == "all" else member["subTypes"]
            for st in names:
                slots_of.setdefault(st, set()).update(group["slots"])
    return sub_types, colours, slots_of, category_of


def load_type_map(path=None):
    return load_json(path or GARMENT_V2 / "type_map.json")


def load_colour_map(path=None):
    return load_json(path or GARMENT_V2 / "colour_map.json")


# ---------------------------------------------------------------- type and colour keys

def map_sub_types(art, type_map):
    """Return (sub_type, prior_slot) Series for an articles frame (None where there is none).

    Jeans are the articles whose product_type_name is Trousers and whose garment_group_name is Trousers Denim.
    """
    pt = art["product_type_name"]
    sub = pt.map({k: v["sub_type"] for k, v in type_map["types"].items()}).astype(object)
    slot = pt.map({k: v["prior_slot"] for k, v in type_map["types"].items()}).astype(object)
    d = type_map["denim"]
    denim = (pt == d["product_type_name"]) & (art["garment_group_name"] == d["garment_group_name"])
    sub = sub.mask(denim, d["sub_type"])
    slot = slot.mask(denim, d["prior_slot"])
    return sub.where(sub.notna(), None), slot.where(slot.notna(), None)


def map_colour_families(art, colour_map):
    """Return the colour family Series (None where the colour has no family) for an articles frame."""
    master = art["perceived_colour_master_name"]
    fam = master.map(colour_map["master_to_family"]).astype(object)
    for rule in colour_map["rules"]:
        cond = pd.Series(True, index=art.index)
        for col, value in rule["if"].items():
            cond &= art[col] == value
        fam = fam.mask(cond, rule["family"])
    fam = fam.mask(master.isin(colour_map["excluded_masters"]), None)
    return fam.where(fam.notna(), None)


class Vocab:
    """Fixed integer codes for the sub-types that fill a prior slot and for the 18 colour families."""

    def __init__(self, type_map, colour_families):
        names = {v["sub_type"]: v["prior_slot"] for v in type_map["types"].values()
                 if v["sub_type"] and v["prior_slot"] in SLOTS}
        d = type_map["denim"]
        names[d["sub_type"]] = d["prior_slot"]
        self.types = sorted(names)
        self.slot_of_type = {t: names[t] for t in self.types}
        self.colours = list(colour_families)
        self.type_id = {t: i for i, t in enumerate(self.types)}
        self.colour_id = {c: i for i, c in enumerate(self.colours)}
        self.slot_id = {s: i for i, s in enumerate(SLOTS)}

    @property
    def n_types(self):
        return len(self.types)

    @property
    def n_colours(self):
        return len(self.colours)


def prepare_articles(art, type_map, colour_map, vocab):
    """Classify the Menswear articles.

    Returns (code_map, valid, stats). code_map maps article_id text to -1 (Menswear but unusable) or to a
    row of `valid`; `valid` has integer arrays slot, type, colour; stats counts the reasons for exclusion.
    """
    men = art[art["index_group_name"] == MENSWEAR].copy()
    men["sub_type"], men["prior_slot"] = map_sub_types(men, type_map)
    men["colour_family"] = map_colour_families(men, colour_map)
    has_slot = men["prior_slot"].isin(SLOTS) & men["sub_type"].notna()
    has_colour = men["colour_family"].notna()
    ok = has_slot & has_colour
    stats = {
        "menswear_articles": int(len(men)),
        "usable_articles": int(ok.sum()),
        "no_slot_accessory_or_other": int((~men["prior_slot"].isin(SLOTS)).sum()),
        "slot_but_no_sub_type": int((men["prior_slot"].isin(SLOTS) & men["sub_type"].isna()).sum()),
        "slot_but_no_colour_family": int((has_slot & ~has_colour).sum()),
    }
    good = men[ok]
    valid = {
        "slot": good["prior_slot"].map(vocab.slot_id).to_numpy(dtype=np.int8),
        "type": good["sub_type"].map(vocab.type_id).to_numpy(dtype=np.int16),
        "colour": good["colour_family"].map(vocab.colour_id).to_numpy(dtype=np.int16),
        "article_id": good["article_id"].tolist(),
    }
    code_map = {a: -1 for a in men["article_id"]}
    code_map.update({a: i for i, a in enumerate(valid["article_id"])})
    return code_map, valid, stats


# ---------------------------------------------------------------- transactions

def minor_customers(customers):
    """customers has customer_id and age. Under 18 is a minor; a missing age is not (D2 decision 4)."""
    index = pd.Index(customers["customer_id"])
    minor = (customers["age"] < MIN_AGE).to_numpy()
    return index, minor


def read_lines(chunks, code_map, cust_index, minor):
    """Filter transaction chunks to usable Menswear lines of adult customers.

    chunks: iterable of DataFrames with t_dat, customer_id, article_id (text). Returns (lines, stats).
    lines has int columns cust, date (days since 1970-01-01), art (row of the valid table), units (raw
    lines collapsed per customer, date and article).
    """
    parts = []
    stats = {"rows": 0, "menswear_rows": 0, "usable_rows": 0, "minor_rows": 0, "unknown_customer_rows": 0,
             "min_date": None, "max_date": None}
    for chunk in chunks:
        stats["rows"] += len(chunk)
        dmin, dmax = chunk["t_dat"].min(), chunk["t_dat"].max()
        stats["min_date"] = dmin if stats["min_date"] is None or dmin < stats["min_date"] else stats["min_date"]
        stats["max_date"] = dmax if stats["max_date"] is None or dmax > stats["max_date"] else stats["max_date"]
        code = chunk["article_id"].map(code_map)
        mens = code.notna().to_numpy()
        stats["menswear_rows"] += int(mens.sum())
        chunk, code = chunk[mens], code[mens].astype(np.int64)
        ok = (code >= 0).to_numpy()
        stats["usable_rows"] += int(ok.sum())
        chunk, code = chunk[ok], code[ok]
        cidx = cust_index.get_indexer(chunk["customer_id"])
        known = cidx >= 0
        stats["unknown_customer_rows"] += int((~known).sum())
        chunk, code, cidx = chunk[known], code[known], cidx[known]
        adult = ~minor[cidx]
        stats["minor_rows"] += int((~adult).sum())
        chunk, code, cidx = chunk[adult], code[adult], cidx[adult]
        days = pd.to_datetime(chunk["t_dat"], format="%Y-%m-%d").to_numpy().astype("datetime64[D]").astype(np.int64)
        parts.append(pd.DataFrame({"cust": cidx.astype(np.int64), "date": days, "art": code.to_numpy(np.int64)}))
    if parts:
        raw = pd.concat(parts, ignore_index=True)
    else:
        raw = pd.DataFrame({"cust": np.array([], np.int64), "date": np.array([], np.int64), "art": np.array([], np.int64)})
    # duplicate lines collapse into a quantity (D2 decision 1); the quantity is kept only as `units`
    lines = raw.groupby(["cust", "date", "art"], sort=True).size().reset_index(name="units")
    stats["max_date"] = None if stats["max_date"] is None else str(stats["max_date"])
    stats["min_date"] = None if stats["min_date"] is None else str(stats["min_date"])
    return lines.astype({"cust": np.int64, "date": np.int64, "art": np.int64, "units": np.int64}), stats


def iter_csv_chunks(path, chunksize=2_000_000):
    """Read transactions_train.csv in chunks, three columns only, ids as text."""
    return pd.read_csv(path, usecols=["t_dat", "customer_id", "article_id"],
                       dtype={"t_dat": str, "customer_id": str, "article_id": str}, chunksize=chunksize)


def date_to_days(text):
    return int(np.datetime64(text, "D").astype(np.int64))


# ---------------------------------------------------------------- baskets and pairs

def build_pairs(lines, valid):
    """Return (pairs, basket_stats). pairs has one row per pair in a basket: sp, basket, cust, date, t1, c1, t2, c2."""
    lines = lines.copy()
    lines["basket"] = lines["cust"] * DATE_SPAN + lines["date"]
    n_art = lines.groupby("basket")["art"].transform("size")
    kept = lines[n_art >= 2]
    stats = {"baskets_with_usable_article": int(lines["basket"].nunique()),
             "baskets_kept": int(kept["basket"].nunique())}
    slot = valid["slot"][kept["art"].to_numpy()]
    frames = []
    for sp, (s1, s2) in enumerate(SLOT_PAIRS):
        i1, i2 = SLOTS.index(s1), SLOTS.index(s2)
        left = kept[slot == i1][["basket", "cust", "date", "art"]]
        right = kept[slot == i2][["basket", "art"]]
        m = left.merge(right, on="basket", suffixes=("1", "2"), how="inner")
        a1, a2 = m["art1"].to_numpy(), m["art2"].to_numpy()
        frames.append(pd.DataFrame({
            "sp": np.full(len(m), sp, dtype=np.int8),
            "basket": m["basket"].to_numpy(), "cust": m["cust"].to_numpy(), "date": m["date"].to_numpy(),
            "t1": valid["type"][a1], "c1": valid["colour"][a1],
            "t2": valid["type"][a2], "c2": valid["colour"][a2]}))
    pairs = pd.concat(frames, ignore_index=True)
    stats["baskets_with_pair"] = int(pairs["basket"].nunique())
    stats["pairs"] = int(len(pairs))
    stats["pairs_by_slot_pair"] = {n: int((pairs["sp"] == i).sum()) for i, n in enumerate(SLOT_PAIR_NAMES)}
    return pairs, stats


# ---------------------------------------------------------------- scores

def _table_ln_lift(first, second, basket, n_first, n_second, smoothing, min_baskets):
    """ln lift matrix (n_first x n_second) and the matrix of basket counts for one slot pair."""
    n = len(first)
    flat = first.astype(np.int64) * n_second + second
    n_ab = np.bincount(flat, minlength=n_first * n_second).reshape(n_first, n_second).astype(float)
    n_a = n_ab.sum(axis=1)
    n_b = n_ab.sum(axis=0)
    expected = np.outer(n_a, n_b) / n
    ln = np.log((n_ab + smoothing) / (expected + smoothing))
    keys = pd.DataFrame({"k": flat, "b": basket}).drop_duplicates()
    baskets = np.bincount(keys["k"].to_numpy(), minlength=n_first * n_second).reshape(n_first, n_second)
    ln = np.where(baskets >= min_baskets, ln, 0.0)
    return np.clip(ln, -LN_CLIP, LN_CLIP), baskets, n_ab


def fit_prior(pairs, n_types, n_colours, smoothing=SMOOTHING, min_baskets=MIN_BASKETS):
    """Fit the lift tables. Returns dict with ln_type[sp,t1,t2], ln_colour[sp,c1,c2] and the counts."""
    ln_t = np.zeros((len(SLOT_PAIRS), n_types, n_types))
    ln_c = np.zeros((len(SLOT_PAIRS), n_colours, n_colours))
    b_t = np.zeros((len(SLOT_PAIRS), n_types, n_types), dtype=np.int64)
    b_c = np.zeros((len(SLOT_PAIRS), n_colours, n_colours), dtype=np.int64)
    n_t = np.zeros((len(SLOT_PAIRS), n_types, n_types))
    for sp in range(len(SLOT_PAIRS)):
        p = pairs[pairs["sp"] == sp]
        if len(p) == 0:
            continue
        basket = p["basket"].to_numpy()
        ln_t[sp], b_t[sp], n_t[sp] = _table_ln_lift(p["t1"].to_numpy(), p["t2"].to_numpy(), basket,
                                                    n_types, n_types, smoothing, min_baskets)
        ln_c[sp], b_c[sp], _ = _table_ln_lift(p["c1"].to_numpy(), p["c2"].to_numpy(), basket,
                                              n_colours, n_colours, smoothing, min_baskets)
    return {"ln_type": ln_t, "ln_colour": ln_c, "baskets_type": b_t, "baskets_colour": b_c, "pairs_type": n_t,
            "min_baskets": min_baskets, "smoothing": smoothing}


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.asarray(x, dtype=float)))


def score_pairs(prior, sp, t1, c1, t2, c2):
    """Score of each pair: sigmoid(clip ln lift of the type pair + clip ln lift of the colour pair)."""
    return sigmoid(prior["ln_type"][sp, t1, t2] + prior["ln_colour"][sp, c1, c2])


def prior_to_json(prior, vocab):
    """The text of pairing-prior-v1.json: version, min_pairs and two tables. No date, hash, id or count."""
    def table(ln, baskets, names):
        out = {}
        for sp, sp_name in enumerate(SLOT_PAIR_NAMES):
            first_slot, second_slot = SLOT_PAIRS[sp]
            rows = {}
            for i, a in enumerate(names):
                for j, b in enumerate(names):
                    if baskets[sp, i, j] >= prior["min_baskets"]:
                        rows.setdefault(a, {})[b] = round(float(sigmoid(ln[sp, i, j])), 6)
            out[sp_name] = rows
        return out
    doc = {
        "version": PRIOR_VERSION,
        "min_pairs": int(prior["min_baskets"]),
        "type_pairs": table(prior["ln_type"], prior["baskets_type"], vocab.types),
        "colour_pairs": table(prior["ln_colour"], prior["baskets_colour"], vocab.colours),
    }
    return json.dumps(doc, sort_keys=True, indent=1, ensure_ascii=True) + "\n"


def unlock_candidates(lines, valid, vocab, limit=MAX_UNLOCK):
    """The Menswear {sub_type, colour_family} combinations most often bought, ordered by count then name."""
    art = lines["art"].to_numpy()
    key = valid["type"][art].astype(np.int64) * vocab.n_colours + valid["colour"][art]
    counts = np.bincount(key, weights=lines["units"].to_numpy(), minlength=vocab.n_types * vocab.n_colours)
    rows = []
    for k in np.nonzero(counts)[0]:
        rows.append((-counts[k], vocab.types[k // vocab.n_colours], vocab.colours[k % vocab.n_colours]))
    rows.sort()
    return [{"sub_type": t, "colour_family": c} for _, t, c in rows[:limit]]


def candidates_to_json(candidates):
    return json.dumps(candidates, indent=1, ensure_ascii=True) + "\n"


# ---------------------------------------------------------------- hashes

def sha256_file(path, block=1 << 22):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(block), b""):
            h.update(b)
    return h.hexdigest()


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
