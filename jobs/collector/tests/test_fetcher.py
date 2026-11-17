"""Robots rules (RFC 9309 as in CC8), the 2 second rate limit with an injected clock, Retry-After, backoff, stop conditions, size cap."""
import email.utils
import socket

import pytest

from collector.fetcher import (MAX_BYTES, CollectorError, ResponseTooLarge, RobotsDisallowed, SourceStopped, parse_retry_after)

OK = (200, {}, b"<html></html>")
E500 = (500, {}, b"")


def gaps(fetcher, url_part=""):
    t = [row[0] for row in fetcher.log if url_part in row[1]]
    return [round(b - a, 6) for a, b in zip(t, t[1:])]


def closed_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


# ---- robots.txt ---------------------------------------------------------------------------------------------------------------------
def test_disallowed_path_is_refused_without_a_request_and_allowed_path_is_fetched(site, make_fetcher):
    f = make_fetcher()
    assert f.fetch(site.base + "/products/tee.html").status == 200
    with pytest.raises(RobotsDisallowed):
        f.fetch(site.base + "/private/secret.html")
    assert site.hits["/private/secret.html"] == 0 and site.hits["/robots.txt"] == 1


def test_robots_is_fetched_once_per_site_and_disallow_is_per_url_not_a_stop(site, make_fetcher):
    f = make_fetcher()
    f.fetch(site.base + "/sitemap.xml")
    with pytest.raises(RobotsDisallowed):
        f.fetch(site.base + "/private/x")
    f.fetch(site.base + "/products/tee.html")          # the source carries on after one refused URL
    assert site.hits["/robots.txt"] == 1 and f.stop_reason(site.base) is None


@pytest.mark.parametrize("status", [400, 403, 404, 410, 451])
def test_4xx_robots_means_allow_all(site, make_fetcher, status):
    site.set("/robots.txt", status, "User-agent: *\nDisallow: /\n")        # the body of an error page must not be read as rules
    assert make_fetcher().fetch(site.base + "/private/x").status == 404


@pytest.mark.parametrize("status", [500, 502, 503, 429])
def test_5xx_robots_stops_the_source_without_counting_a_missed_run(site, make_fetcher, status):
    f = make_fetcher()
    site.set("/robots.txt", status)
    with pytest.raises(SourceStopped) as err:
        f.fetch(site.base + "/a")
    assert err.value.code == "robots_unreachable" and err.value.counts_missed_run is False
    assert f.stop_reason(site.base) == "robots_unreachable"
    before = dict(site.hits)
    with pytest.raises(SourceStopped):
        f.fetch(site.base + "/b")                      # a stopped source is never contacted again
    assert dict(site.hits) == before and site.hits["/a"] == 0 and len(f.log) == 1       # no retry on robots.txt either


def test_network_failure_on_robots_stops_the_source(make_fetcher):
    f = make_fetcher()
    with pytest.raises(SourceStopped) as err:
        f.fetch(f"http://127.0.0.1:{closed_port()}/a")
    assert err.value.code == "robots_unreachable" and not err.value.counts_missed_run


def test_robots_too_large_or_redirect_loop_stops_the_source(site, make_fetcher):
    site.set("/robots.txt", 200, b"#" * (MAX_BYTES + 1))
    with pytest.raises(SourceStopped):
        make_fetcher().fetch(site.base + "/a")
    site.set("/robots.txt", 302, headers={"Location": "/robots.txt"})
    with pytest.raises(SourceStopped):
        make_fetcher().fetch(site.base + "/a")


def test_robots_redirect_without_a_location_stops_the_source(site, make_fetcher):
    site.set("/robots.txt", 302)
    with pytest.raises(SourceStopped) as err:
        make_fetcher().fetch(site.base + "/a")
    assert err.value.code == "robots_unreachable" and site.hits["/a"] == 0


def test_robots_redirect_inside_the_site_is_followed(site, make_fetcher):
    site.set("/robots.txt", 301, headers={"Location": "/robots-real.txt"})
    site.set("/robots-real.txt", 200, "User-agent: *\nDisallow: /no/\n")
    with pytest.raises(RobotsDisallowed):
        make_fetcher().fetch(site.base + "/no/x")


@pytest.mark.parametrize("rules", ["User-agent: SpartaPilotBot\nDisallow: /\n", "User-agent: *\nDisallow: /\n",
                                   "User-agent: *\nAllow: /\n\nUser-agent: spartapilotbot\nDisallow: /p"])
def test_robots_groups_for_our_agent_or_everyone_are_honoured(site, make_fetcher, rules):
    site.set("/robots.txt", 200, rules)
    with pytest.raises(RobotsDisallowed):
        make_fetcher().fetch(site.base + "/p")


def test_other_agents_rules_do_not_bind_us_and_empty_robots_allows_all(site, make_fetcher):
    site.set("/robots.txt", 200, "User-agent: OtherBot\nDisallow: /\n")
    assert make_fetcher().fetch(site.base + "/p").status == 404
    site.set("/robots.txt", 200, "")
    assert make_fetcher().fetch(site.base + "/p").status == 404


# ---- rate limit ---------------------------------------------------------------------------------------------------------------------
def test_at_most_one_request_per_two_seconds_including_robots(site, make_fetcher, clock):
    f = make_fetcher()
    for name in ("/products/tee.html", "/products/graph.html", "/products/list.html", "/sitemap.xml"):
        f.fetch(site.base + name)
    assert len(f.log) == 5 and gaps(f) == [2.0, 2.0, 2.0, 2.0] and clock.t == 8.0


def test_no_sleep_when_two_seconds_have_already_passed(site, make_fetcher, clock):
    f = make_fetcher()
    f.fetch(site.base + "/sitemap.xml")
    clock.t += 5
    f.fetch(site.base + "/sitemap.xml")
    assert clock.sleeps == [2.0] and gaps(f) == [2.0, 5.0]


def test_each_site_has_its_own_limit(site, make_fetcher, clock):
    from conftest import LocalSite
    other = LocalSite()
    other.thread.start()
    try:
        f = make_fetcher()
        f.fetch(site.base + "/sitemap.xml")
        t = clock.t
        f.fetch(other.base + "/sitemap.xml")
        assert f.log[2][1] == other.base + "/robots.txt" and f.log[2][0] == t      # the first request to another site is not delayed
    finally:
        other.httpd.shutdown(); other.httpd.server_close(); other.thread.join(timeout=5)


@pytest.mark.parametrize("delay,expected", [(5, 5.0), (3, 3.0), (1, 2.0), (0, 2.0)])
def test_crawl_delay_above_two_seconds_is_honoured_and_never_below_two(site, make_fetcher, delay, expected):
    site.set("/robots.txt", 200, f"User-agent: *\nCrawl-delay: {delay}\n")
    f = make_fetcher()
    f.fetch(site.base + "/a"); f.fetch(site.base + "/b")
    assert gaps(f, "/a") == [] and gaps(f) == [expected, expected]


# ---- Retry-After, backoff, stop ----------------------------------------------------------------------------------------------------
def test_retry_after_seconds_is_honoured(site, make_fetcher):
    site.script("/p", (503, {"Retry-After": "7"}, b""), OK)
    f = make_fetcher()
    assert f.fetch(site.base + "/p").status == 200
    assert gaps(f, "/p") == [7.0]


def test_retry_after_http_date_is_honoured(site, make_fetcher, clock):
    when = email.utils.formatdate(clock.wall0 + 40, usegmt=True)
    site.script("/p", (429, {"Retry-After": when}, b""), OK)
    f = make_fetcher()
    assert f.fetch(site.base + "/p").status == 200
    assert 36 <= gaps(f, "/p")[0] <= 40            # 2 seconds had already passed on the fake clock when the header was read


def test_retry_after_longer_than_five_minutes_stops_the_source(site, make_fetcher):
    site.set("/p", 503, headers={"Retry-After": "3600"})
    with pytest.raises(SourceStopped) as err:
        make_fetcher().fetch(site.base + "/p")
    assert err.value.code == "retry_after_too_long" and not err.value.counts_missed_run and site.hits["/p"] == 1


@pytest.mark.parametrize("value,expected", [("120", 120.0), ("0", 0.0), (" 5 ", 5.0), ("-5", None), ("1e3", None), ("soon", None), ("", None),
                                            (None, None), ("Thu, 01 Jan 1970 00:00:00 GMT", 0.0), ("٣", None)])
def test_parse_retry_after(value, expected):
    assert parse_retry_after(value, 1_800_000_000.0) == expected


def test_backoff_doubles_on_errors(site, make_fetcher):
    site.script("/p", E500, E500, OK)
    f = make_fetcher()
    assert f.fetch(site.base + "/p").status == 200
    assert gaps(f, "/p") == [2.0, 4.0]


def test_three_consecutive_errors_stop_the_source_and_count_no_missed_run(site, make_fetcher):
    site.set("/p", 500)
    f = make_fetcher()
    with pytest.raises(SourceStopped) as err:
        f.fetch(site.base + "/p")
    assert err.value.code == "repeated_errors" and err.value.counts_missed_run is False and site.hits["/p"] == 3
    with pytest.raises(SourceStopped):
        f.fetch(site.base + "/other")
    assert site.hits["/other"] == 0


def test_a_success_resets_the_error_count(site, make_fetcher):
    site.script("/p", E500, OK, E500, OK, E500, OK)
    f = make_fetcher()
    assert [f.fetch(site.base + "/p").status for _ in range(3)] == [200, 200, 200]       # three failures in all, never three in a row


def test_dropped_connections_count_as_errors_and_stop_the_source(site, make_fetcher):
    site.routes["/p"] = lambda n: None
    with pytest.raises(SourceStopped) as err:
        make_fetcher().fetch(site.base + "/p")
    assert err.value.code == "repeated_errors" and site.hits["/p"] == 3


def test_404_page_is_returned_and_is_not_an_error(site, make_fetcher):
    f = make_fetcher()
    assert [f.fetch(site.base + "/missing").status for _ in range(5)] == [404] * 5 and f.stop_reason(site.base) is None


# ---- size cap and redirects ---------------------------------------------------------------------------------------------------------
def test_response_over_five_megabytes_is_refused_and_exactly_five_is_kept(site, make_fetcher):
    site.set("/big", 200, b"x" * (MAX_BYTES + 1))
    site.set("/edge", 200, b"x" * MAX_BYTES)
    f = make_fetcher()
    with pytest.raises(ResponseTooLarge):
        f.fetch(site.base + "/big")
    assert len(f.fetch(site.base + "/edge").body) == MAX_BYTES


def test_declared_length_over_the_cap_is_refused_before_reading(site, make_fetcher):
    site.set("/big", 200, b"tiny", {"Content-Length": str(MAX_BYTES + 1)})
    with pytest.raises(ResponseTooLarge):
        make_fetcher().fetch(site.base + "/big")


def test_redirects_inside_the_site_are_followed_through_robots_and_the_limit(site, make_fetcher):
    site.set("/old", 301, headers={"Location": "/products/tee.html"})
    site.set("/to-private", 302, headers={"Location": "/private/x"})
    f = make_fetcher()
    assert f.fetch(site.base + "/old").url.endswith("/products/tee.html")
    with pytest.raises(RobotsDisallowed):
        f.fetch(site.base + "/to-private")
    assert min(gaps(f)) >= 2.0


def test_redirect_loop_is_cut_after_three_hops(site, make_fetcher):
    site.set("/a", 302, headers={"Location": "/b"}); site.set("/b", 302, headers={"Location": "/a"})
    with pytest.raises(CollectorError) as err:
        make_fetcher().fetch(site.base + "/a")
    assert err.value.code == "too_many_redirects" and site.hits["/a"] + site.hits["/b"] == 4
