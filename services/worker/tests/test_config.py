import pytest

from helpers import BEARER_ENV, base_env
from worker.config import ConfigError, Settings, parse_host_rewrite

BASE = base_env()


def env(**kw):
    return {**BASE, **kw}


def test_defaults_guess_off_and_model_v1():
    s = Settings.from_env(env())
    assert s.garment_guess_enabled is False                      # CC6: default false until the team-photo evaluation is done
    assert s.garment_model_version == "garment-cnn-v1" and s.garment_min_confidence == 0.6 and s.signed_url_host_rewrite is None


@pytest.mark.parametrize("value,expected", [("true", True), ("1", True), ("TRUE", True), ("false", False), ("0", False), ("", False)])
def test_guess_switch(value, expected):
    assert Settings.from_env(env(GARMENT_GUESS_ENABLED=value)).garment_guess_enabled is expected


def test_guess_switch_rejects_garbage():
    with pytest.raises(ConfigError):
        Settings.from_env(env(GARMENT_GUESS_ENABLED="maybe"))


def test_model_version_2_is_refused():
    with pytest.raises(ConfigError):
        Settings.from_env(env(GARMENT_MODEL_VERSION="garment-cnn-v2"))


@pytest.mark.parametrize("bad", ["0", "-0.1", "1.5", "abc"])
def test_confidence_bounds(bad):
    with pytest.raises(ConfigError):
        Settings.from_env(env(GARMENT_MIN_CONFIDENCE=bad))


def test_confidence_accepts_a_value():
    assert Settings.from_env(env(GARMENT_MIN_CONFIDENCE="0.8")).garment_min_confidence == 0.8


def test_short_token_and_missing_values_are_refused():
    with pytest.raises(ConfigError):
        Settings.from_env(env(**{BEARER_ENV: "short"}))
    for name in BASE:
        with pytest.raises(ConfigError):
            Settings.from_env({k: v for k, v in env().items() if k != name})


def test_error_messages_never_hold_the_secret():
    with pytest.raises(ConfigError) as e:
        Settings.from_env(env(**{BEARER_ENV: "secret-short"}))
    assert "secret-short" not in str(e.value)


@pytest.mark.parametrize("ok", ["host.docker.internal:54321", "127.0.0.1:54321", "localhost:1", "host.lima.internal:65535"])
def test_rewrite_allow_list_accepts(ok):
    assert parse_host_rewrite(ok) == ok


@pytest.mark.parametrize("bad", ["evil.example:54321", "host.docker.internal", "host.docker.internal:0", "host.docker.internal:70000",
                                 "host.docker.internal:54321/x", "user@host.docker.internal:54321", "http://host.docker.internal:54321",
                                 "host.docker.internal.evil.com:54321"])
def test_rewrite_allow_list_rejects(bad):
    with pytest.raises(ConfigError):
        parse_host_rewrite(bad)
    with pytest.raises(ConfigError):
        Settings.from_env(env(SIGNED_URL_HOST_REWRITE=bad))


@pytest.mark.parametrize("base", ["http://example.com", "ftp://host", "https://user:pw@example.com", "https://example.com/path", "https://"])
def test_api_base_url_must_be_a_safe_origin(base):
    with pytest.raises(ConfigError):
        Settings.from_env(env(WORKER_API_BASE_URL=base))


def test_https_base_url_and_worker_id():
    assert Settings.from_env(env(WORKER_API_BASE_URL="https://app.example.com/")).api_base_url == "https://app.example.com"
    with pytest.raises(ConfigError):
        Settings.from_env(env(WORKER_ID="bad id!"))
