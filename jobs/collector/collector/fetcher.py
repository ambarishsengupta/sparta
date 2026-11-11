"""Polite fetcher (LLD 8.1 steps 2 and 3, Data Sourcing Policy section 5). Standard library only.
NETWORK SAFETY: every URL (first request, robots.txt, every redirect hop) passes check_host() BEFORE any socket is opened; a host other
than 127.0.0.1, ::1 or localhost raises live_collection_disabled unless COLLECTOR_LIVE=1 (no agent sets it). Proxies are switched off."""
from __future__ import annotations

import email.utils
import http.client
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import timezone
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})
MIN_INTERVAL = 2.0          # seconds between request starts per site (Policy section 5)
MAX_BYTES = 5 * 1024 * 1024
MAX_ERRORS = 3              # consecutive failures before the source is stopped
MAX_RETRY_AFTER = 300.0     # a longer Retry-After stops the source instead of sleeping
MAX_REDIRECTS = 3
BACKOFF_BASE = 2.0
ROBOTS_AGENT = "SpartaPilotBot"
DEFAULT_REPO_URL = "https://example.test/sparta-repo-url-not-set"   # placeholder: the real URL is owner decision O2
REDIRECTS = (301, 302, 303, 307, 308)


class CollectorError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(code + (": " + detail if detail else ""))
        self.code = code


class LiveCollectionDisabled(CollectorError):
    pass


class SourceStopped(CollectorError):
    """A whole source stopped early (LLD 8.1 step 2 or repeated errors). Such a run must NOT count a missed run (step 6)."""
    counts_missed_run = False


class RobotsDisallowed(CollectorError):
    pass


class ResponseTooLarge(CollectorError):
    pass


class RealClock:
    def monotonic(self): return time.monotonic()
    def time(self): return time.time()
    def sleep(self, s): time.sleep(s)


@dataclass
class Response:
    url: str
    status: int
    body: bytes
    headers: dict

    @property
    def location(self):
        return self.headers.get("location")


@dataclass
class _Site:
    robots: RobotFileParser | None = None
    delay: float = MIN_INTERVAL
    last: float | None = None
    not_before: float = 0.0
    errors: int = 0
    stopped: str | None = None


def user_agent(env=None) -> str:
    url = (env if env is not None else os.environ).get("COLLECTOR_REPO_URL") or DEFAULT_REPO_URL
    return "SpartaPilotBot/0.1 (+" + "".join(c for c in url if c.isprintable() and c not in " \t") + ")"


def check_host(url: str):
    """The guard. Returns the split URL, or raises before anything touches the network."""
    try:
        parts = urlsplit(url)
        host, _ = parts.hostname, parts.port
    except ValueError:
        raise CollectorError("bad_url") from None
    if parts.scheme not in ("http", "https") or not host:
        raise CollectorError("unsupported_url")
    if host in LOOPBACK_HOSTS or os.environ.get("COLLECTOR_LIVE") == "1":
        return parts
    raise LiveCollectionDisabled("live_collection_disabled", "host " + host)


def parse_retry_after(value, now_wall: float):
    """Seconds to wait from a Retry-After header (delta-seconds or HTTP-date), or None."""
    value = (value or "").strip()
    if value.isascii() and value.isdigit():
        return float(value)
    try:
        when = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0.0, when.timestamp() - now_wall)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None   # redirects are followed by hand so every hop passes the guard, robots and the rate limit


def _build_opener():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect)


class Fetcher:
    def __init__(self, clock=None, repo_url: str | None = None, opener=None, timeout: float = 10.0):
        self.clock = clock or RealClock()
        self.ua = user_agent({"COLLECTOR_REPO_URL": repo_url} if repo_url else None)
        self.opener = opener or _build_opener()
        self.timeout = timeout
        self.sites: dict[str, _Site] = {}
        self.log: list[tuple[float, str, int | None]] = []   # (clock time, url, status or None): the rate-limit timing log

    def fetch(self, url: str) -> Response:
        """GET a page: guard, robots.txt, rate limit, redirects. Raises CollectorError subclasses; SourceStopped ends the source."""
        return self._follow(url, check_robots=True)

    def stop_reason(self, url: str):
        return self.sites.get(self._key(urlsplit(url)), _Site()).stopped

    @staticmethod
    def _key(parts) -> str:
        return f"{parts.scheme}://{parts.netloc}".lower()

    def _follow(self, url: str, check_robots: bool) -> Response:
        for _ in range(MAX_REDIRECTS + 1):
            parts = check_host(url)
            site = self.sites.setdefault(self._key(parts), _Site())
            if site.stopped:
                raise SourceStopped(site.stopped)
            if check_robots:
                self._ensure_robots(parts, site)
                if not site.robots.can_fetch(ROBOTS_AGENT, url):
                    raise RobotsDisallowed("robots_disallowed", parts.path)
            resp = self._request(url, site, is_robots=not check_robots)
            if resp.status in REDIRECTS and resp.location:
                url = urljoin(url, resp.location)
                continue
            return resp
        raise CollectorError("too_many_redirects")

    def _ensure_robots(self, parts, site: _Site) -> None:
        if site.robots is not None:
            return
        try:
            resp = self._follow(f"{parts.scheme}://{parts.netloc}/robots.txt", check_robots=False)
        except (SourceStopped, LiveCollectionDisabled):
            raise
        except CollectorError:
            self._stop(site, "robots_unreachable")   # too large or too many redirects: treated as unreachable
        rp = RobotFileParser()
        if 200 <= resp.status < 300:
            rp.parse(resp.body.decode("utf-8", "replace").splitlines())
            site.delay = max(MIN_INTERVAL, float(rp.crawl_delay(ROBOTS_AGENT) or 0))
        elif 400 <= resp.status < 500:
            rp.allow_all = True       # RFC 9309 2.3.1.3: robots.txt unavailable (4xx) means no restrictions
        else:
            self._stop(site, "robots_unreachable")
        site.robots = rp

    @staticmethod
    def _stop(site: _Site, reason: str):
        site.stopped = reason
        raise SourceStopped(reason)

    def _wait(self, site: _Site) -> None:
        now = self.clock.monotonic()
        ready = max(site.not_before, site.last + site.delay if site.last is not None else 0.0)
        if ready > now:
            self.clock.sleep(ready - now)
        site.last = self.clock.monotonic()

    def _once(self, url: str) -> Response:
        req = urllib.request.Request(url, method="GET", headers={
            "User-Agent": self.ua, "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.1"})
        try:
            r = self.opener.open(req, timeout=self.timeout)
        except urllib.error.HTTPError as err:
            r = err
        with r:
            length = r.headers.get("Content-Length", "")
            if length.isdigit() and int(length) > MAX_BYTES:
                raise ResponseTooLarge("response_too_large")
            body = r.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ResponseTooLarge("response_too_large")
            return Response(url, r.code if isinstance(r, urllib.error.HTTPError) else r.status, body,
                            {k.lower(): v for k, v in r.headers.items()})

    def _request(self, url: str, site: _Site, is_robots: bool) -> Response:
        while True:
            self._wait(site)
            try:
                resp = self._once(url)
            except (OSError, http.client.HTTPException):
                resp = None
            self.log.append((site.last, url, resp.status if resp else None))
            if resp is not None and resp.status < 500 and resp.status != 429:
                site.errors = 0
                return resp
            if is_robots:
                self._stop(site, "robots_unreachable")   # 5xx, 429 or network failure on robots.txt: stop, do not count a missed run
            site.errors += 1
            wait = parse_retry_after(resp.headers.get("retry-after"), self.clock.time()) if resp else None
            if wait is not None and wait > MAX_RETRY_AFTER:
                self._stop(site, "retry_after_too_long")
            if site.errors >= MAX_ERRORS:
                self._stop(site, "repeated_errors")
            site.not_before = self.clock.monotonic() + max(wait or 0.0, BACKOFF_BASE * 2 ** (site.errors - 1))
