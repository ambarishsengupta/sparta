"""Extraction (LLD 8.1 step 4, Data Sourcing Policy section 3): JSON-LD Product markup and sitemaps. Standard library only.
A record holds ONLY the whitelisted fields below: images, descriptions, reviews and ratings are never copied out."""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from .fetcher import CollectorError

FIELDS = ("sku", "name", "brand", "category_hint", "colour", "sizes", "price", "currency", "gtin", "product_url")
GTIN_KEYS = ("gtin", "gtin14", "gtin13", "gtin12", "gtin8")
MAX_URLS = 50000


class _LdParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.blocks: list[str] = []
        self._buf = None

    def handle_starttag(self, tag, attrs):
        if tag == "script" and (dict(attrs).get("type") or "").strip().lower() == "application/ld+json":
            self._buf = []

    def handle_data(self, data):
        if self._buf is not None:
            self._buf.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._buf is not None:
            self.blocks.append("".join(self._buf))
            self._buf = None


def _text(v, limit=200):
    if isinstance(v, dict):
        v = v.get("name")
    if isinstance(v, list):
        v = next((x for x in v if isinstance(x, (str, dict))), None)
        v = v.get("name") if isinstance(v, dict) else v
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    return v.strip()[:limit] if isinstance(v, str) and v.strip() else None


def _types(node) -> list:
    t = node.get("@type")
    return t if isinstance(t, list) else [t]


def _products(node, depth=0):
    """Product nodes of a JSON-LD value: top level, @graph and ItemList (itemListElement, item). Nothing else is walked."""
    if depth > 8:
        return
    if isinstance(node, list):
        for n in node:
            yield from _products(n, depth + 1)
    elif isinstance(node, dict):
        if "Product" in _types(node):
            yield node
        yield from _products(node.get("@graph"), depth + 1)
        if "ItemList" in _types(node) or "ListItem" in _types(node):
            yield from _products(node.get("itemListElement"), depth + 1)
            yield from _products(node.get("item"), depth + 1)


def _gtin(node):
    for key in GTIN_KEYS:
        digits = re.sub(r"[ -]", "", str(node.get(key) or ""))
        if digits.isascii() and digits.isdigit() and len(digits) in (8, 12, 13, 14):
            return digits.zfill(14)
    return None


def _offer(node):
    offers = node.get("offers")
    for o in offers if isinstance(offers, list) else [offers]:
        if isinstance(o, dict):
            raw = o.get("price", o.get("lowPrice"))
            text = str(raw).strip()
            text = text.replace(",", ".") if re.fullmatch(r"\d+,\d{1,2}", text) else text.replace(",", "")   # "59,00" is 59.00, "1,299" is 1299
            try:
                price = Decimal(text) if raw is not None and not isinstance(raw, bool) else None
            except InvalidOperation:
                price = None
            if price is not None and price.is_finite() and price >= 0:
                cur = o.get("priceCurrency")
                return price, cur.upper() if isinstance(cur, str) and re.fullmatch(r"[A-Za-z]{3}", cur) else None
    return None, None


def _sizes(v):
    v = [v] if isinstance(v, (str, dict)) else v if isinstance(v, list) else []
    out = []
    for item in v:
        out += [p.strip()[:20] for p in (_text(item, 100) or "").split(",") if p.strip()]
    return out[:30]


def extract_products(html: str, page_url: str) -> list[dict]:
    """Whitelisted records from the JSON-LD Product markup of one page. Broken JSON blocks are skipped."""
    parser = _LdParser()
    parser.feed(html)
    parser.close()
    records = []
    for block in parser.blocks[:200]:
        try:
            data = json.loads(block)
        except ValueError:
            continue
        for node in _products(data):
            name = _text(node.get("name"))
            url = _text(node.get("url"), 2000)
            url = urljoin(page_url, url) if url else page_url
            if not name or urlsplit(url).scheme not in ("http", "https"):
                continue
            price, currency = _offer(node)
            records.append({"sku": _text(node.get("sku"), 100) or url, "name": name, "brand": _text(node.get("brand")),
                            "category_hint": _text(node.get("category")), "colour": _text(node.get("color")),
                            "sizes": _sizes(node.get("size")), "price": price, "currency": currency, "gtin": _gtin(node),
                            "product_url": url})
    return records


@dataclass
class Sitemap:
    kind: str            # "urlset" (page addresses) or "sitemapindex" (more sitemaps)
    locs: list[str]


def parse_sitemap(data: bytes) -> Sitemap:
    """Refuses any XML with a DOCTYPE or ENTITY declaration BEFORE parsing (no entity expansion, no external entities)."""
    if b"\x00" in data:
        raise CollectorError("xml_refused", "binary or UTF-16 content")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise CollectorError("xml_refused", "not UTF-8") from None
    if re.search(r"<!\s*(doctype|entity)", text, re.IGNORECASE):
        raise CollectorError("xml_refused", "DOCTYPE or ENTITY declaration")
    try:
        root = ET.fromstring(text.encode("utf-8"))
    except ET.ParseError:
        raise CollectorError("xml_refused", "not well-formed") from None
    kind = root.tag.rsplit("}", 1)[-1]
    if kind not in ("urlset", "sitemapindex"):
        raise CollectorError("xml_refused", "not a sitemap")
    locs = [(el.text or "").strip() for el in root.iter() if el.tag.rsplit("}", 1)[-1] == "loc"]
    return Sitemap(kind, [u for u in locs if urlsplit(u).scheme in ("http", "https")][:MAX_URLS])


def same_site(urls: list[str], base_url: str) -> list[str]:
    """Only addresses on the source's own site: a sitemap cannot send the collector to another host."""
    netloc = urlsplit(base_url).netloc.lower()
    return [u for u in urls if urlsplit(u).netloc.lower() == netloc]
