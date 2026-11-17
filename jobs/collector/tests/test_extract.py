"""Extraction: whitelisted fields only, JSON-LD Product (plain, @graph, ItemList), gtin padding, sku fallback, sitemaps and XML refusal."""
import json
import xml.etree.ElementTree as ET
from decimal import Decimal

import pytest

from collector.extract import FIELDS, extract_products, parse_sitemap, same_site
from collector.fetcher import CollectorError

BASE = "http://127.0.0.1:1"


def ld(*nodes):
    return "".join(f'<script type="application/ld+json">{json.dumps(n)}</script>' for n in nodes)


def one(node, url=BASE + "/p/x"):
    return extract_products(ld({"@type": "Product", "name": "Test Tee", **node}), url)[0]


def test_single_product_page_gives_exactly_the_whitelisted_fields(site):
    (rec,) = extract_products(site.page("products/tee.html"), site.base + "/products/tee.html")
    assert tuple(rec) == FIELDS
    assert rec == {"sku": "ZV-TEE-01", "name": "Heavy Cotton T-Shirt", "brand": "Zorvane", "category_hint": "Menswear > Tops", "colour": "Navy Blue",
                   "sizes": ["S", "M", "L"], "price": Decimal("24.50"), "currency": "EUR", "gtin": "02900000000011",
                   "product_url": site.base + "/products/tee.html"}


def test_images_descriptions_reviews_and_ratings_never_reach_a_record(site):
    text = repr(extract_products(site.page("products/tee.html"), BASE))
    for marker in ("DESCRIPTION-MARKER", "REVIEW-MARKER", "REVIEWER-MARKER", "img.example.test", ".jpg", "4.6", "aggregateRating"):
        assert marker not in text


def test_graph_page_yields_only_the_product(site):
    (rec,) = extract_products(site.page("products/graph.html"), site.base + "/products/graph.html")
    assert (rec["name"], rec["brand"], rec["sizes"], rec["price"], rec["currency"]) == ("Slim Chinos", "Quillibrook", ["30", "32", "34"], Decimal("59.00"), "GBP")
    assert rec["gtin"] == "00000029000013" and rec["sku"] == rec["product_url"] == site.base + "/products/graph.html"


def test_item_list_page_yields_listed_and_bare_products_and_skips_broken_json(site):
    recs = extract_products(site.page("products/list.html"), site.base)
    assert [r["name"] for r in recs] == ["Wool Blazer", "Mystery Gadget", "Leather Belt"]
    assert recs[0]["gtin"] == "00290000000028" and recs[0]["colour"] == "#1F2A44" and recs[0]["price"] == Decimal(120)
    assert recs[1]["gtin"] == "20290000000035" and recs[1]["sku"] == site.base + "/products/pb-2.html"      # sku falls back to the product URL
    assert recs[2]["sku"] == "PB-3" and recs[2]["price"] is None and recs[2]["gtin"] is None


def test_page_without_structured_data_gives_nothing(site):
    assert extract_products(site.page("products/none.html"), BASE) == []


@pytest.mark.parametrize("digits,expected", [("29000013", "00000029000013"), ("290000000028", "00290000000028"), ("2900000000011", "02900000000011"),
                                             ("20290000000035", "20290000000035"), ("290 0000 0000 11", "02900000000011"), ("290-0000-000011", "02900000000011")])
def test_gtin_variants_are_padded_to_14(digits, expected):
    for key in ("gtin", "gtin8", "gtin12", "gtin13", "gtin14"):
        assert one({key: digits})["gtin"] == expected


@pytest.mark.parametrize("bad", ["1234567", "123456789", "1234567890", "12345678901", "123456789012345", "29000013x", "abcdefgh", "", None, 29000013.5])
def test_other_gtin_lengths_and_junk_are_dropped(bad):
    assert one({"gtin13": bad})["gtin"] is None


def test_first_valid_gtin_key_wins_and_numbers_work():
    assert one({"gtin": "bad", "gtin13": 2900000000011})["gtin"] == "02900000000011"


@pytest.mark.parametrize("node,sku", [({"sku": "A-1"}, "A-1"), ({}, BASE + "/p/x"), ({"sku": ""}, BASE + "/p/x"), ({"sku": "  "}, BASE + "/p/x"), ({"sku": 4711}, "4711"),
                                      ({"sku": "A", "url": "/p/y"}, "A")])
def test_sku_and_fallback(node, sku):
    assert one(node)["sku"] == sku


def test_relative_product_url_is_resolved_and_missing_url_uses_the_page():
    assert one({"url": "/p/y?c=1"})["product_url"] == BASE + "/p/y?c=1" and one({})["product_url"] == BASE + "/p/x"


@pytest.mark.parametrize("raw,price", [("24.50", "24.50"), (24, "24"), ("59,00", "59.00"), ("1,299.00", "1299.00"), ("1,299", "1299"), ("-1", None), ("abc", None),
                                       ("NaN", None), ("Infinity", None), (True, None), (None, None)])
def test_price_parsing(raw, price):
    assert one({"offers": {"price": raw, "priceCurrency": "USD"}})["price"] == (Decimal(price) if price else None)


def test_offers_list_uses_first_priced_offer_and_currency_must_be_three_letters():
    assert one({"offers": [{"@type": "Offer"}, {"price": "5", "priceCurrency": "gbp"}]})["currency"] == "GBP"
    assert one({"offers": {"price": "5", "priceCurrency": "EURO"}})["currency"] is None
    assert one({"offers": {"lowPrice": "4.00", "priceCurrency": "USD"}})["price"] == Decimal("4.00")


def test_brand_category_colour_and_size_shapes():
    rec = one({"brand": {"name": "Ostrelle"}, "category": ["Tops", "Tees"], "color": ["Red", "Blue"], "size": {"name": "XL"}})
    assert (rec["brand"], rec["category_hint"], rec["colour"], rec["sizes"]) == ("Ostrelle", "Tops", "Red", ["XL"])
    assert one({"size": ["S, M", "L"]})["sizes"] == ["S", "M", "L"] and len(one({"size": ",".join(map(str, range(99)))})["sizes"]) == 30


@pytest.mark.parametrize("node", [{"name": ""}, {"name": None}, {"name": 5.5 and ""}, {"url": "javascript:alert(1)"}, {"url": "ftp://127.0.0.1/x"}])
def test_products_without_a_name_or_with_a_non_http_url_are_skipped(node):
    assert extract_products(ld({"@type": "Product", **{"name": "N", **node}}), BASE) == []


def test_only_product_types_are_taken_and_extra_fields_stay_out():
    html = ld({"@type": "Organization", "name": "Org"}, {"@type": ["Thing", "Product"], "name": "Tee", "reviewBody": "R", "image": ["i.jpg"], "description": "D"},
              {"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "item": {"@type": "Event", "name": "No"}}]})
    (rec,) = extract_products(html, BASE)
    assert tuple(rec) == FIELDS and "R" not in repr(rec).replace("Tee", "") and rec["name"] == "Tee"


# ---- sitemaps -------------------------------------------------------------------------------------------------------------------------
def test_urlset_and_index(site):
    sm = parse_sitemap(site.page("sitemap.xml").encode())
    assert sm.kind == "urlset" and len(sm.locs) == 4
    idx = parse_sitemap(site.page("sitemap-index.xml").encode())
    assert idx.kind == "sitemapindex" and idx.locs == [site.base + "/sitemap.xml"]


def test_a_sitemap_cannot_send_the_collector_to_another_host(site):
    locs = parse_sitemap(site.page("sitemap.xml").encode()).locs
    assert same_site(locs, site.base) == [u for u in locs if u.startswith(site.base)] and len(same_site(locs, site.base)) == 3


def test_non_http_locations_are_dropped():
    xml = b'<urlset xmlns="x"><url><loc>file:///etc/passwd</loc></url><url><loc>javascript:1</loc></url><url><loc>http://127.0.0.1/a</loc></url></urlset>'
    assert parse_sitemap(xml).locs == ["http://127.0.0.1/a"]


BOMB = ('<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><urlset xmlns="x"><url><loc>http://127.0.0.1/&b;</loc></url></urlset>')


@pytest.mark.parametrize("xml", [BOMB, BOMB.lower(), '<!DOCTYPE urlset><urlset/>', '<?xml version="1.0"?><!  DOCTYPE urlset><urlset/>',
                                 '<urlset><!ENTITY x "y"></urlset>', '<urlset><!-- <!DOCTYPE x> --></urlset>',
                                 '<!DOCTYPE urlset SYSTEM "http://evil.example.test/x.dtd"><urlset/>'])
def test_doctype_or_entity_is_refused_before_the_parser_runs(xml, monkeypatch):
    def boom(*a, **k): raise AssertionError("the XML parser must not run")
    monkeypatch.setattr(ET, "fromstring", boom)
    with pytest.raises(CollectorError) as err:
        parse_sitemap(xml.encode())
    assert err.value.code == "xml_refused"


@pytest.mark.parametrize("data", ['<urlset xmlns="x"/>'.encode("utf-16"), b'<\x00u\x00r\x00l\x00', b"\xff\xfe<", b"<urlset><url>", b"<html/>", b""])
def test_other_unsafe_or_broken_xml_is_refused(data):
    with pytest.raises(CollectorError):
        parse_sitemap(data)
