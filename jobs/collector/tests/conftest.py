"""Shared fixtures: a LOCAL test HTTP server on 127.0.0.1 (ephemeral port, started and stopped by the test), a fake clock, and a network
guard that makes any non-loopback connection attempt a test failure while recording every attempt."""
from __future__ import annotations

import ipaddress
import socket
import sys
import threading
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SITE = Path(__file__).resolve().parent / "site"
sys.path.insert(0, str(ROOT))


def _loopback(host) -> bool:
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == "localhost"


@pytest.fixture(autouse=True)
def net(monkeypatch):
    """Every address handed to connect() or getaddrinfo() during a test; a non-loopback one fails the test on the spot."""
    monkeypatch.delenv("COLLECTOR_LIVE", raising=False)
    attempts, real_connect, real_gai = [], socket.socket.connect, socket.getaddrinfo

    def connect(self, addr):
        attempts.append(addr[0] if isinstance(addr, tuple) else addr)
        if not _loopback(attempts[-1]):
            raise AssertionError(f"non-loopback connect attempted: {addr!r}")
        return real_connect(self, addr)

    def gai(host, *a, **k):
        attempts.append(host)
        if host is not None and not _loopback(host):
            raise AssertionError(f"non-loopback lookup attempted: {host!r}")
        return real_gai(host, *a, **k)

    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket, "getaddrinfo", gai)
    return attempts


class FakeClock:
    """Injected clock: sleep() advances time at once, so rate-limit tests take no real time."""
    def __init__(self):
        self.t, self.wall0, self.sleeps = 0.0, 1_800_000_000.0, []

    def monotonic(self): return self.t
    def time(self): return self.wall0 + self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s


@pytest.fixture
def clock():
    return FakeClock()


class LocalSite:
    """Routes: path -> (status, headers, body) or a function of the hit number returning one (None drops the connection).
    Unlisted paths are served from tests/site with {BASE} replaced by this server's address, else 404."""
    def __init__(self):
        self.routes, self.hits, self.agents = {}, Counter(), []
        site = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                path = self.path.split("?")[0]
                site.hits[path] += 1
                site.agents.append(self.headers.get("User-Agent"))
                route = site.routes.get(path)
                if callable(route):
                    route = route(site.hits[path] - 1)
                if route is None and path not in site.routes:
                    f = SITE / path.lstrip("/")
                    route = (200, {}, f.read_text().replace("{BASE}", site.base).encode()) if f.is_file() else (404, {}, b"")
                if route is None:
                    self.close_connection = True
                    return
                status, headers, body = route
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                if "Content-Length" not in headers:
                    self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a): pass

        class Quiet(ThreadingHTTPServer):
            def handle_error(self, request, client_address): pass       # a dropped connection is a scripted case, not noise

        self.httpd = Quiet(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)

    def set(self, path, status=200, body=b"", headers=None):
        self.routes[path] = (status, headers or {}, body.encode() if isinstance(body, str) else body)

    def script(self, path, *responses):
        """The n-th hit gets responses[n]; the last one repeats. Each is (status, headers, body) or None (drop the connection)."""
        self.routes[path] = lambda n: responses[min(n, len(responses) - 1)]

    def page(self, name):
        return (SITE / name).read_text().replace("{BASE}", self.base)


@pytest.fixture
def site():
    s = LocalSite()
    s.thread.start()
    try:
        yield s
    finally:
        s.httpd.shutdown()
        s.httpd.server_close()
        s.thread.join(timeout=5)


@pytest.fixture
def make_fetcher(clock):
    from collector.fetcher import Fetcher
    return lambda **kw: Fetcher(clock=clock, **kw)
