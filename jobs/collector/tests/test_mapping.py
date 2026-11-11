"""Mapping tables against the taxonomy and the swatch table, and the mapping of categories, colours and whole records."""
import json
import re
from pathlib import Path

import pytest

from collector.mapping import MAPPING_DIR, map_category, map_colour, map_record

REPO = Path(__file__).resolve().parents[3]
TAXONOMY = json.loads((REPO / "packages/taxonomy/src/taxonomy.json").read_text())
SUB_TYPES = {(c["name"], s) for c in TAXONOMY["categories"] for s in c["subTypes"]}
COLOUR = json.loads((MAPPING_DIR / "colour.json").read_text())
RULES = json.loads((MAPPING_DIR / "category.json").read_text())["rules"]
SEED = (REPO / "supabase/seed/lookups.sql").read_text()


def seed_reference(family):
    """First row of the family in the seed's swatch table (colour_family_ref): the reference swatch."""
    m = re.search(r"\(\d+, '%s', '#([0-9A-F]{6})'" % family, SEED)
    return tuple(int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4))


@pytest.mark.parametrize("rule", RULES, ids=lambda r: r["sub_type"])
def test_every_mapped_category_and_sub_type_exists_in_the_taxonomy(rule):
    assert (rule["category"], rule["sub_type"]) in SUB_TYPES and rule["words"]


def test_every_taxonomy_sub_type_has_a_rule():
    assert {(r["category"], r["sub_type"]) for r in RULES} == SUB_TYPES


def test_every_mapped_colour_family_exists_and_every_family_rgb_equals_the_swatch_table():
    families = {f["family"]: f["swatches"] for f in TAXONOMY["colourFamilies"] if f["family"] != "Multi"}
    assert set(COLOUR["families"]) == set(families)
    for name, entry in COLOUR["families"].items():
        first = families[name][0]
        assert tuple(entry["rgb"]) == tuple(int(first[i:i + 2], 16) for i in (1, 3, 5)) == seed_reference(name), name


def test_retail_synonyms_from_the_lld_are_present_and_names_are_unique_across_families():
    names = [n for f in COLOUR["families"].values() for n in f["names"]]
    assert len(names) == len(set(names)) and all(n == n.lower() for n in names)
    assert {"navy", "khaki", "beige", "olive", "maroon", "burgundy", "charcoal", "tan", "camel"} <= set(names)


def test_css_table_holds_valid_hex_codes_and_no_name_twice_with_a_family():
    assert all(re.fullmatch(r"#[0-9A-F]{6}", h) for h in COLOUR["css"].values()) and len(COLOUR["css"]) >= 50


@pytest.mark.parametrize("text,family", [("navy", "Navy"), ("Navy Blue", "Navy"), ("KHAKI", "Khaki"), ("Beige", "Beige"), ("olive green", "Olive"), ("maroon", "Maroon"),
                                         ("Burgundy", "Maroon"), ("charcoal", "Grey"), ("tan", "Khaki"), ("camel", "Khaki"), ("Royal Blue", "Blue"), ("Jet Black", "Black"),
                                         ("off-white", "White"), ("Dark Charcoal Melange", "Grey"), ("light blue/white", "Blue"),
                                         ("Stone Grey", "Grey"), ("coral", "Red"), ("wheat", "Beige")])
def test_family_names_and_retail_synonyms_map_to_the_family_reference_rgb(text, family):
    assert map_colour(text) == (tuple(COLOUR["families"][family]["rgb"]), False)


def test_css_names_come_after_family_names_and_hex_comes_last():
    assert map_colour("cornflowerblue") == ((100, 149, 237), False)
    assert map_colour("royal blue")[0] == (30, 90, 168) and map_colour("royalblue")[0] == (65, 105, 225)      # a family synonym beats the CSS name
    assert map_colour("#1F2A44") == ((31, 42, 68), False) and map_colour("#fff") == ((255, 255, 255), False) and map_colour("#0a0B0c") == ((10, 11, 12), False)


@pytest.mark.parametrize("text", ["facade", "bad", "#12345", "#GGGGGG", "1F2A44", "shimmering void", "", None, "   "])
def test_unknown_colours_and_hex_lookalike_words_are_unmapped(text):
    assert map_colour(text) == (None, False)


@pytest.mark.parametrize("text", ["Multicolour", "multi-color", "Assorted"])
def test_multicolour_words(text):
    assert map_colour(text) == (None, True)


@pytest.mark.parametrize("name,hint,expected", [
    ("Heavy Cotton T-Shirt", None, ("Tops", "T-shirt")), ("Zorvane Polo Shirt", None, ("Tops", "Polo")), ("Wool Blazer", None, ("Outerwear", "Blazer")),
    ("Sports T-Shirt", None, ("Activewear", "Sports T-shirt")), ("Track Jacket", None, ("Activewear", "Track jacket")), ("Nehru Jacket", None, ("Ethnic wear", "Nehru jacket")),
    ("Boot-cut Jeans", None, ("Bottoms", "Jeans")), ("Slim Chinos", None, ("Bottoms", "Chinos")), ("Leather Belt", None, ("Accessories", "Belt")),
    ("Oxford Shoes", None, ("Footwear", "Formal shoes")), ("Zorvane Classic", "Footwear > Sneakers", ("Footwear", "Sneakers")), ("Denim Shirt", "Jacket", ("Tops", "Shirt")),
    ("Cotton Kurta", None, ("Ethnic wear", "Kurta")), ("Wool Socks 3 pack", None, ("Underwear and socks", "Socks")), ("Mystery Gadget", "Gadgets", (None, None)),
    ("Shirtdress", None, (None, None)), ("TSHIRT", None, ("Tops", "T-shirt")), (None, None, (None, None))])
def test_category_mapping(name, hint, expected):
    assert map_category(name, hint) == expected


REC = {"sku": "S1", "name": "Heavy Cotton T-Shirt", "brand": "Zorvane", "category_hint": None, "colour": "Navy Blue", "sizes": ["S", "M"], "price": 24, "currency": "EUR",
       "gtin": "02900000000011", "product_url": "http://127.0.0.1/p"}


def test_mapped_record_is_active_with_rgb_and_taxonomy_values():
    row = map_record(REC)
    assert (row["status"], row["category"], row["sub_type"], (row["colour_r"], row["colour_g"], row["colour_b"])) == ("active", "Tops", "T-shirt", (31, 42, 68))
    assert row["is_multicolour"] is False and row["sizes_available"] == ["S", "M"] and row["gtin"] == "02900000000011" and row["product_url"] == "http://127.0.0.1/p"
    assert set(row) == {"sku", "name", "brand", "gtin", "category", "sub_type", "colour_r", "colour_g", "colour_b", "is_multicolour", "sizes_available", "price", "currency",
                        "product_url", "status"}


@pytest.mark.parametrize("change,nulls", [({"name": "Mystery Gadget"}, ("category", "sub_type")), ({"colour": "shimmering void"}, ("colour_r", "colour_g", "colour_b")),
                                          ({"colour": None}, ("colour_r",)), ({"name": "Mystery Gadget", "colour": "plaid"}, ("category", "sub_type", "colour_r"))])
def test_unmapped_rows_come_out_as_review_with_nulls(change, nulls):
    row = map_record({**REC, **change})
    assert row["status"] == "review" and all(row[k] is None for k in nulls)


def test_multicolour_item_is_active_without_rgb_and_empty_sizes_become_null():
    row = map_record({**REC, "colour": "Multicolour", "sizes": []})
    assert row["status"] == "active" and row["is_multicolour"] and row["colour_r"] is None and row["sizes_available"] is None
