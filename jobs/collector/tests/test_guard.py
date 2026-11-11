"""The loopback guard (CC8: no non-loopback connection, ever), the user agent, and what the synthetic site may contain."""
import re
import socket
from pathlib import Path

import pytest

from collector.fetcher import CollectorError, LiveCollectionDisabled, check_host, user_agent

ROOT = Path(__file__).resolve().parents[1]
UA_FORBIDDEN = ("H" + "&M", "H & " + "M", "Hen" + "nes", "hm" + ".com")      # CC13, spelled in pieces so this file passes its own scan


@pytest.mark.parametrize("url", ["http://example.com/", "https://shop.example.test/p", "http://127.0.0.1.evil.test/", "http://localhost.evil.test/",
                                 "http://127.0.0.1@evil.test/", "http://10.0.0.1/", "http://0.0.0.0/", "http://[::2]/", "http://2130706433/",
                                 "http://LOCALHOST.example.test:80/", "http://localhost./"])
def test_guard_refuses_every_non_loopback_host_before_a_socket_opens(url, net, make_fetcher):
    with pytest.raises(LiveCollectionDisabled) as err:
        check_host(url)
    assert err.value.code == "live_collection_disabled"
    with pytest.raises(LiveCollectionDisabled):
        make_fetcher().fetch(url)
    assert net == []         # not even a name lookup


@pytest.mark.parametrize("url", ["ftp://127.0.0.1/x", "file:///etc/passwd", "http:///nohost", "http://127.0.0.1:99999/"])
def test_guard_refuses_other_schemes_and_bad_urls(url, net):
    with pytest.raises(CollectorError):
        check_host(url)
    assert net == []


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://localhost:8080/x", "https://[::1]:8443/x", "http://LocalHost/"])
def test_guard_allows_loopback(url):
    assert check_host(url).hostname in ("127.0.0.1", "localhost", "::1")


def test_live_switch_is_exactly_one(monkeypatch):
    for value in ("0", "true", "", "yes"):
        monkeypatch.setenv("COLLECTOR_LIVE", value)
        with pytest.raises(LiveCollectionDisabled):
            check_host("http://shop.example.test/")
    monkeypatch.setenv("COLLECTOR_LIVE", "1")
    assert check_host("http://shop.example.test/").hostname == "shop.example.test"      # the guard only; nothing is fetched in any test


def test_redirect_to_another_host_is_refused_and_never_connected(site, net, make_fetcher):
    site.set("/go", 302, headers={"Location": "http://evil.example.test/x"})
    with pytest.raises(LiveCollectionDisabled):
        make_fetcher().fetch(site.base + "/go")
    assert all(a in ("127.0.0.1", "localhost", "::1") for a in net)
    assert "evil.example.test" not in net


def test_robots_redirect_to_another_host_is_refused(site, net, make_fetcher):
    site.set("/robots.txt", 301, headers={"Location": "https://cdn.example.test/robots.txt"})
    with pytest.raises(LiveCollectionDisabled):
        make_fetcher().fetch(site.base + "/a")
    assert site.hits["/a"] == 0 and "cdn.example.test" not in net


def test_proxy_settings_are_ignored(site, monkeypatch, make_fetcher):
    for var in ("http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
        monkeypatch.setenv(var, "http://proxy.example.test:3128")
    assert make_fetcher().fetch(site.base + "/sitemap.xml").status == 200       # the autouse guard would fail on a proxy connection


def test_user_agent_is_exact_and_sent_on_every_request(site, monkeypatch, make_fetcher):
    monkeypatch.delenv("COLLECTOR_REPO_URL", raising=False)
    assert user_agent() == "SpartaPilotBot/0.1 (+https://example.test/sparta-repo-url-not-set)"
    monkeypatch.setenv("COLLECTOR_REPO_URL", "https://git.example.test/sparta")
    assert user_agent() == "SpartaPilotBot/0.1 (+https://git.example.test/sparta)"
    f = make_fetcher()
    f.fetch(site.base + "/sitemap.xml")
    assert site.agents == ["SpartaPilotBot/0.1 (+https://git.example.test/sparta)"] * 2      # robots.txt and the page


def test_user_agent_cannot_carry_a_header_injection():
    assert user_agent({"COLLECTOR_REPO_URL": "https://a.test/x\r\nX-Evil: 1"}) == "SpartaPilotBot/0.1 (+https://a.test/xX-Evil:1)"


def test_socket_spy_sees_only_loopback_during_a_whole_fetch(site, net, make_fetcher):
    make_fetcher().fetch(site.base + "/products/tee.html")
    assert net and all(a in ("127.0.0.1", "localhost", "::1") for a in net)


def test_synthetic_site_uses_only_loopback_or_example_test_hosts():
    hosts = set()
    for f in (ROOT / "tests" / "site").rglob("*"):
        if f.is_file():
            hosts |= set(re.findall(r"https?://([^/\s\"'<>:]+)", f.read_text()))
    assert hosts, "no URLs found: the scan is broken"
    assert all(h == "{BASE}" or h in ("127.0.0.1", "localhost") or h == "example.test" or h.endswith(".example.test") or h == "www.sitemaps.org"
               or h == "schema.org" for h in hosts), hosts


def test_no_forbidden_names_anywhere_in_the_collector_tree():
    for f in ROOT.rglob("*"):
        if f.is_file() and f.suffix in (".py", ".json", ".html", ".xml", ".txt", ".ini"):
            text = f.read_text().lower()
            assert not any(w.lower() in text for w in UA_FORBIDDEN), f


def test_gate_runs_collector_tests_after_worker_tests_with_a_hard_timeout():
    gate = (ROOT.parents[1] / "workflow/gates/gate.sh").read_text()
    order = [m for m in re.findall(r'run_stage "(\w+)"', gate)]
    assert order.index("collector_tests") == order.index("worker_tests") + 1
    script = (ROOT.parents[1] / "workflow/gates/collector_tests.sh").read_text()
    assert "timeout 300 " in script and "SKIPPED" in script and "SPARTA_VENV_PYTHON" in script
