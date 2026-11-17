"""Local settings for the offline pairing scripts (LLD 12.3, workflow/local.env.example).

The two settings are SPARTA_DATA_ROOT_HM (read-only H&M folder) and SPARTA_ARTIFACT_DIR (the only
folder the scripts write JSON and caches to). They come from an env file (default: the first
workflow/local.env found by walking up from this script) and the process environment overrides it.
Nothing here is hard-coded and nothing is written.
"""
import os
from pathlib import Path

HM_KEY = "SPARTA_DATA_ROOT_HM"
ARTIFACT_KEY = "SPARTA_ARTIFACT_DIR"


def find_env_file(start=None):
    """Walk up from `start` (default: this file) and return workflow/local.env if one exists, else None."""
    here = Path(start if start is not None else __file__).resolve()
    for folder in [here] + list(here.parents):
        candidate = folder / "workflow" / "local.env"
        if candidate.is_file():
            return candidate
    return None


def parse_env_file(path):
    """Parse KEY=VALUE lines. Comments (#) and blank lines are skipped; one pair of quotes is removed."""
    values = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def load_settings(env_file=None, environ=None):
    """Return {HM_KEY: Path, ARTIFACT_KEY: Path}. Environment variables override the env file."""
    environ = os.environ if environ is None else environ
    values = {}
    path = Path(env_file) if env_file else find_env_file()
    if path is not None:
        if not path.is_file():
            raise SystemExit(f"env file not found: {path}")
        values.update(parse_env_file(path))
    for key in (HM_KEY, ARTIFACT_KEY):
        if environ.get(key):
            values[key] = environ[key]
    missing = [k for k in (HM_KEY, ARTIFACT_KEY) if not values.get(k)]
    if missing:
        raise SystemExit(f"missing setting(s) {', '.join(missing)}: set them in workflow/local.env or the environment")
    settings = {k: Path(values[k]) for k in (HM_KEY, ARTIFACT_KEY)}
    for key, folder in settings.items():
        if not folder.is_absolute():
            raise SystemExit(f"{key} must be an absolute path, got: {folder}")
    return settings
