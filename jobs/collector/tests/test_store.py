"""WO-0087 without a database: the database guard, the CLI refusals, and what the collector code may never contain."""
import io
import re
from pathlib import Path

import psycopg
import pytest

from collector import __main__ as cli
from collector.fetcher import CollectorError
from collector.store import SKIP_DAYS, UPSERT, WITHDRAW_AT, check_db_url

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("url", ["postgresql://u:p@127.0.0.1:54322/postgres", "postgresql://u:p@localhost/db", "postgresql://u:p@[::1]:5432/db",
                                 "host=127.0.0.1 user=u dbname=db"])
def test_loopback_database_is_accepted(url):
    check_db_url(url)


@pytest.mark.parametrize("url", ["postgresql://u:p@db.example.com:5432/postgres", "postgresql://u:p@127.0.0.1/db?host=evil.example.com",
                                 "postgresql://u:p@127.0.0.1,evil.example.com/db", "postgresql://u:p@/db", "postgresql:///db",
                                 "postgresql://u:p@127.0.0.1/db?hostaddr=203.0.113.9", "postgresql://u@evil.example.com@127.0.0.1/db",
                                 "postgresql://u:p@LOCALHOST.example.com/db", "postgresql://u:p@10.0.0.5/db"])
def test_other_databases_are_refused_before_any_connection(url, monkeypatch):
    monkeypatch.setattr(psycopg, "connect", lambda *a, **k: pytest.fail("a connection was attempted"))
    with pytest.raises(CollectorError) as err:
        cli.connect(url)
    assert err.value.code == "database_not_local"


def test_hostaddr_from_the_environment_cannot_redirect_a_local_url(monkeypatch):
    monkeypatch.setenv("PGHOSTADDR", "203.0.113.9")
    with pytest.raises(CollectorError):
        check_db_url("postgresql://u:p@127.0.0.1/db")


def test_a_malformed_database_url_is_refused_and_live_needs_the_switch(monkeypatch):
    with pytest.raises(CollectorError) as err:
        check_db_url("postgresql://u:p@[::1/db")
    assert err.value.code == "bad_database_url"
    monkeypatch.setenv("COLLECTOR_LIVE", "1")
    check_db_url("postgresql://u:p@db.example.com/db")


def run_cli(env, argv=("run",)):
    out = io.StringIO()
    return cli.main(list(argv), env=env, out=out), out.getvalue()


def test_cli_without_a_database_url_or_with_a_remote_one_runs_nothing(capsys, monkeypatch):
    monkeypatch.setattr(psycopg, "connect", lambda *a, **k: pytest.fail("a connection was attempted"))
    assert run_cli({})[0] == 2 and "COLLECTOR_DATABASE_URL is not set" in capsys.readouterr().err
    assert run_cli({"COLLECTOR_DATABASE_URL": "postgresql://u:secretpw@db.example.com/db"})[0] == 2
    err = capsys.readouterr().err
    assert "database_not_local" in err and "secretpw" not in err and "db.example.com" not in err


def test_constants_match_the_spec():
    assert (SKIP_DAYS, WITHDRAW_AT) == (6, 2)
    assert "vendor_id" in UPSERT and "on conflict (source_id, vendor_id, sku)" in UPSERT and "missed_runs = 0" in UPSERT


def test_collector_code_holds_no_key_password_or_service_role():
    for path in (ROOT / "collector").glob("*.py"):
        text = path.read_text()
        assert not re.search(r"service_role|sb_secret|SECRET_KEY|SERVICE_ROLE|alter role|create role|grant ", text, re.I), path.name
        assert not re.search(r"postgres(ql)?://[^\s\"']*:[^\s\"'@]+@", text), path.name       # no connection string with a password
