"""Settings from the environment, validated once at start. Nothing here is logged: the database URL and the token are secrets."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Mapping
from urllib.parse import urlsplit

LOCAL_HOSTS = ("127.0.0.1", "localhost")
# Hosts a container may use to reach the machine that runs the local Supabase stack. Nothing else is accepted as a rewrite target.
REWRITE_HOSTS = ("host.docker.internal", "host.lima.internal", "gateway.docker.internal", "127.0.0.1", "localhost")
SUPPORTED_MODEL = "garment-cnn-v1"          # version 2 is not allowed: models.manifest.json does not permit it (LLD 7.8)


class ConfigError(ValueError):
    """The environment is wrong. The message names the variable, never its value."""


def _bool(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None or raw == "":
        return default
    if raw.lower() in ("true", "1"):
        return True
    if raw.lower() in ("false", "0"):
        return False
    raise ConfigError(f"{name} must be true or false")


def parse_host_rewrite(value: str) -> str:
    """`host:port` on the allow-list; returns it unchanged."""
    m = re.fullmatch(r"([a-z0-9.-]+):([0-9]{1,5})", value)
    if not m or m.group(1) not in REWRITE_HOSTS or not 1 <= int(m.group(2)) <= 65535:
        raise ConfigError("SIGNED_URL_HOST_REWRITE must be host:port with a host from the allow-list")
    return value


@dataclass(frozen=True)
class Settings:
    database_url: str
    api_base_url: str
    api_token: str
    garment_guess_enabled: bool = False                 # LLD 7.7 / LOI-9: OFF until the team-photo evaluation is done
    garment_model_version: str = SUPPORTED_MODEL
    garment_min_confidence: float = 0.6
    signed_url_host_rewrite: str | None = None
    signed_url_allowed_hosts: tuple[str, ...] = ()
    worker_id: str = "worker-1"
    poll_seconds: float = 3.0
    run_loop: bool = True

    @staticmethod
    def from_env(env: Mapping[str, str]) -> "Settings":
        def need(name: str) -> str:
            v = env.get(name, "")
            if not v:
                raise ConfigError(f"{name} is required")
            return v
        token = need("WORKER_API_TOKEN")
        if len(token) < 32:
            raise ConfigError("WORKER_API_TOKEN must be at least 32 characters")
        base = need("WORKER_API_BASE_URL").rstrip("/")
        parts = urlsplit(base)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.path or parts.query:
            raise ConfigError("WORKER_API_BASE_URL must be an origin such as http://host:3000")
        if parts.scheme == "http" and parts.hostname not in REWRITE_HOSTS:
            raise ConfigError("WORKER_API_BASE_URL must use https unless it is a local host")
        version = env.get("GARMENT_MODEL_VERSION") or SUPPORTED_MODEL
        if version != SUPPORTED_MODEL:
            raise ConfigError(f"GARMENT_MODEL_VERSION must be {SUPPORTED_MODEL}")
        try:
            conf = float(env.get("GARMENT_MIN_CONFIDENCE") or 0.6)
        except ValueError:
            raise ConfigError("GARMENT_MIN_CONFIDENCE must be a number") from None
        if not 0.0 < conf <= 1.0:
            raise ConfigError("GARMENT_MIN_CONFIDENCE must be above 0 and at most 1")
        rewrite = env.get("SIGNED_URL_HOST_REWRITE") or None
        if rewrite:
            parse_host_rewrite(rewrite)
        allowed = tuple(h.strip() for h in (env.get("SIGNED_URL_ALLOWED_HOSTS") or "").split(",") if h.strip())
        worker_id = env.get("WORKER_ID") or "worker-1"
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", worker_id):
            raise ConfigError("WORKER_ID must be 1 to 64 letters, digits, dot, dash or underscore")
        return Settings(
            database_url=need("WORKER_DATABASE_URL"), api_base_url=base, api_token=token,
            garment_guess_enabled=_bool(env, "GARMENT_GUESS_ENABLED", False), garment_model_version=version,
            garment_min_confidence=conf, signed_url_host_rewrite=rewrite, signed_url_allowed_hosts=allowed,
            worker_id=worker_id, run_loop=_bool(env, "WORKER_RUN_LOOP", True))
