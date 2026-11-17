"""Mapping to the taxonomy (LLD 8.1 step 5) through the hand-written tables in jobs/collector/mapping/*.json. Nothing here learns from
data. A row with any unmapped category, sub-type or colour comes out with status 'review' and nulls for what could not be mapped."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

MAPPING_DIR = Path(__file__).resolve().parent.parent / "mapping"
HEX = re.compile(r"#([0-9a-f]{6}|[0-9a-f]{3})")   # the # is required: "facade" and "bad" are words


def _norm(s) -> str:
    return re.sub(r"\s+", " ", (s or "").lower().replace("_", " ")).strip()


def _find(table: list[tuple[str, object]], text: str):
    """The value whose key occurs as a whole word or phrase in text: leftmost, then longest key."""
    best = None
    for key, value in table:
        m = re.search(r"(?<![a-z0-9])" + re.escape(key) + r"(?![a-z0-9])", text)
        if m and (best is None or (m.start(), -len(key)) < best[0]):
            best = ((m.start(), -len(key)), value)
    return best[1] if best else None


@lru_cache(maxsize=None)
def _tables(directory: Path = MAPPING_DIR):
    cat = json.loads((directory / "category.json").read_text())["rules"]
    col = json.loads((directory / "colour.json").read_text())
    rules = [(w, (r["category"], r["sub_type"])) for r in cat for w in r["words"]]
    names = [(n, tuple(f["rgb"])) for f in col["families"].values() for n in f["names"]]
    css = [(n, tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))) for n, h in col["css"].items()]
    return cat, names, css, col["multi_words"]


def map_category(name, hint):
    """(category, sub_type) from the first rule that matches the name, then the hint; (None, None) when nothing matches."""
    cat = _tables()[0]
    for text in (_norm(name), _norm(hint)):
        for r in cat:       # rule order matters: specific before general
            if _find([(w, (r["category"], r["sub_type"])) for w in r["words"]], text):
                return r["category"], r["sub_type"]
    return None, None


def map_colour(text):
    """(rgb or None, is_multicolour): family names and retail synonyms, then CSS names, then a hex code."""
    _, names, css, multi = _tables()
    t = _norm(text)
    if _find([(w, True) for w in multi], t):
        return None, True
    for table in (names, css):
        rgb = _find(table, t)
        if rgb:
            return rgb, False
    m = HEX.fullmatch(t)
    if m:
        h = m.group(1) if len(m.group(1)) == 6 else "".join(c * 2 for c in m.group(1))
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)), False
    return None, False


def map_record(rec: dict) -> dict:
    """A whitelisted record from the extractor -> a catalog_items-shaped row (no database code here)."""
    category, sub_type = map_category(rec["name"], rec.get("category_hint"))
    rgb, multi = map_colour(rec.get("colour"))
    ok = category and sub_type and (rgb is not None or multi)
    r, g, b = rgb if rgb else (None, None, None)
    return {"sku": rec["sku"], "name": rec["name"], "brand": rec.get("brand"), "gtin": rec.get("gtin"), "category": category,
            "sub_type": sub_type, "colour_r": r, "colour_g": g, "colour_b": b, "is_multicolour": multi,
            "sizes_available": rec.get("sizes") or None, "price": rec.get("price"), "currency": rec.get("currency"),
            "product_url": rec["product_url"], "status": "active" if ok else "review"}
