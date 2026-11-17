# WO-0086 notes (R6c, Release 0: collector fetch, robots, rate limit, extraction, mapping)

Release 0 re-cut applies (no dedicated security review; gate, Spec QC and the mutation proof apply). No database code, no commit, nothing pushed, no live website contacted, no scraped data stored.

## What exists now (all under `jobs/collector/`, Python standard library only; `requirements.txt` pins `psycopg[binary]==3.3.8`, not imported yet)
- `collector/fetcher.py`: the loopback guard `check_host()` (any host other than `127.0.0.1`, `::1`, `localhost` raises `live_collection_disabled` BEFORE any lookup or socket, unless `COLLECTOR_LIVE` is exactly `1`; only http and https; checked for the first request, for `robots.txt` and for EVERY redirect hop, redirects being followed by hand); proxies switched off (`ProxyHandler({})`, so `HTTP_PROXY` cannot route a request elsewhere); robots through `urllib.robotparser` with the RFC 9309 status rules (2xx parse, 4xx allow-all, 5xx, 429, network failure, oversize or redirect loop stop the source as `robots_unreachable`); `Crawl-delay` above 2 s honoured, never below 2 s; at most one request start per 2 s per site (`scheme://host:port`), injected clock; `Retry-After` in seconds and HTTP-date form; exponential backoff (2, 4 s); three consecutive errors or a `Retry-After` over 300 s raise `SourceStopped` (class attribute `counts_missed_run = False`: WO-0087 must not count a missed run for it); 5 MB cap (declared length checked first); exact user agent `SpartaPilotBot/0.1 (+<COLLECTOR_REPO_URL>)`, default placeholder `https://example.test/sparta-repo-url-not-set` (owner decision O2), control characters and spaces stripped. `Fetcher.log` is the timing log of every request.
- `collector/extract.py`: `extract_products(html, page_url)` gives records with exactly the ten whitelisted fields (`FIELDS`: sku, name, brand, category_hint, colour, sizes, price, currency, gtin, product_url) from JSON-LD `Product` (top level, `@graph`, `ItemList`/`ListItem`); nothing else is walked or copied, so images, descriptions, reviews and ratings cannot reach a record; gtin from `gtin`, `gtin14/13/12/8`, lengths 8/12/13/14 only, padded to 14; sku falls back to the product URL; `59,00` reads as 59.00; `parse_sitemap(bytes)` refuses NUL bytes, non-UTF-8, any `<!DOCTYPE` or `<!ENTITY` (also in a comment, any case, any spacing) BEFORE the XML parser runs, keeps only http(s) locations; `same_site()` drops other hosts.
- `collector/mapping.py` and `mapping/category.json`, `mapping/colour.json`: first-match keyword rules (40 sub-types, every taxonomy sub-type has a rule), family names and retail synonyms to the family's reference RGB (first swatch), then 83 CSS names, then a `#` hex code (a bare `facade` or `bad` is not a colour). `map_record()` returns a `catalog_items`-shaped row: status `review` and nulls whenever the category, sub-type or colour cannot be mapped, `active` otherwise.
- `tests/`: a local `ThreadingHTTPServer` on 127.0.0.1 port 0 started and stopped by a fixture; an autouse fixture that records every `connect` and `getaddrinfo` and FAILS the test on a non-loopback address (so a bug in the code cannot reach the network even while a test runs), and removes `COLLECTOR_LIVE`; the synthetic site `tests/site/` (invented brands Zorvane, Quillibrook, Pemberlow, Wexmarrow; URLs only `{BASE}` = the local server, `example.test` and its subdomains; a test enforces the host list and a test scans the whole tree for the CC13 strings).
- `workflow/gates/collector_tests.sh` and the `collector_tests` stage in `gate.sh` straight after `worker_tests`. No gate-order test existed; `test_guard.py::test_gate_runs_collector_tests_after_worker_tests_with_a_hard_timeout` now pins the order and the 300 s timeout (nothing loosened).

## Tests
240 pytest items (73 test functions, parametrised): guard, user agent, site and gate checks 29, fetcher (robots, rate, Retry-After, backoff, stop, size, redirects) 48, extraction 64, mapping 99. Run time about 3 s (the fake clock never sleeps). Mutation proof: `WO-0086-mutation.md` (48 of 48 killed).

## Rate-limit timing log (real clock, local test server only; `Fetcher.log`)
```
t+ 0.00s  200  LOCAL/robots.txt
t+ 2.01s  200  LOCAL/sitemap.xml
t+ 4.01s  200  LOCAL/products/tee.html
t+ 6.02s  200  LOCAL/products/graph.html
```

## Decisions to check
1. Counted lines are far over the 650 flag (see the report: about 1,200 including tests). The 40-test minimum, the 15-mutant proof and the safety tests, not the mapping breadth (JSON, not counted), drove it. Nothing was cut from the guard or the robots rules.
2. A redirect is a separate request: each hop is guarded, robots-checked and rate-limited, at most 3 hops, then `too_many_redirects` (a per-URL error, not a stop).
3. 429 on `robots.txt` stops the source like a 5xx (conservative; RFC 9309 treats only 5xx as unreachable); on ordinary pages 429 counts as an error and honours `Retry-After`.
4. A `Retry-After` over 300 s stops the source (`retry_after_too_long`, no missed run) instead of sleeping for an hour.
5. The XML refusal is deliberately blunt: any `<!doctype` or `<!entity` text anywhere, even in a comment, is refused.
6. `price` is a `Decimal` (the database column is numeric(12,2)); `category_hint` is the JSON-LD `category` (first value of a list).

## Not done / not verified
- No database code, no run loop, no CLI (WO-0087). The `db` marker is declared in `pytest.ini` but no test uses it.
- No overall per-request deadline beyond the 10 s socket timeout (a server dripping a byte every 9 s could hold a request for long; the 5 MB cap bounds the bytes, not the time). WO-0087's run loop should add a per-source time budget.
- The guard trusts the name `localhost` as the resolver returns it (an /etc/hosts entry pointing it elsewhere would defeat it); the tests' socket spy checks the resolved addresses are loopback.
- The colour and category tables are small hand-written tables, not tuned on any real catalogue; unmapped items go to the review queue by design.
