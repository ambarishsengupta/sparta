# Sparta worker

A FastAPI service (LLD 7) whose job is a background loop: it claims photo jobs from `app.jobs`, removes the background, makes WebP files, and (only when switched on) suggests a category and sub-type with the garment model v1. `/health` is its only route and is not published.

## What it does for a photo job (LLD 7.3)

1. Claims one job with `app.claim_job()` as the database role `worker_role` (`for update skip locked`; at most 3 attempts; a failed attempt is requeued 30 seconds later; the reaper in the database handles a crashed worker). Every write that finishes a job checks `status = 'running' and attempts = <claimed>`, so a result of a reaped job is discarded.
2. Asks the web app for signed URLs (`POST /api/worker/signed-urls`, bearer `WORKER_API_TOKEN`). Bytes go in and out **only** through those URLs; the worker holds no storage key and never the Supabase secret key.
3. Validates the picture by content (JPEG, PNG, WebP; at most 5 MB; at most 6,000 px on the long side and 36 million pixels; not animated; EXIF rotation applied). A picture that fails is `failed` at once (`file_too_large`, `image_too_large`, `not_an_image`, `animated_image`), because a retry cannot help.
4. Removes the background (`rembg`, model `u2netp`) behind the `BackgroundRemover` interface (tests use a fake), makes `cutout` (at most 1,200 px, WebP quality 80, with transparency), `thumb` and `original_thumb` (320 px), and a dominant colour (k-means, k = 3).
5. Optional garment guess (see below), then uploads the three files and writes `result = {path, thumb_path, original_thumb_path, dominant_rgb, garment}`. Receipt jobs are failed with `unsupported_job_type` until the receipt release.

Logs hold only job ids, attempt numbers, outcomes and fixed error words: never image bytes, paths, user ids, URLs or tokens (`httpx` logging is held at WARNING because a signed URL carries its token). `last_error` is a fixed code word, never an exception message.

## Garment guess: OFF by default

`GARMENT_GUESS_ENABLED` defaults to **false**. The 100-photo team evaluation of LLD 7.7 is not done, so the confidence threshold (`GARMENT_MIN_CONFIDENCE`, default 0.6) is only the documented default and the app must show no suggestion (LOI-9). With the switch off the result carries `garment: null`. `GARMENT_MODEL_VERSION` accepts only `garment-cnn-v1` (version 2 is not permitted by `models.manifest.json`). The model is `models/garment-cnn-v1.onnx` (Fashion-MNIST only; its SHA-256 is pinned by the model card and a test). The preprocessing is a byte-identical copy of `ml/recommendation-engine/garment/preprocess.py` (a test compares the hashes). Dress maps to no category. Nothing in this service comes from H&M data.

## Configuration (environment)

| Variable | Meaning |
| --- | --- |
| `WORKER_DATABASE_URL` | connection string for `worker_role` (secret) |
| `WORKER_API_BASE_URL` | origin of the web app (https, or a local host for http) |
| `WORKER_API_TOKEN` | the bearer token, at least 32 characters (secret; the web app has the same value as `WORKER_API_TOKEN`) |
| `SIGNED_URL_HOST_REWRITE` | `host:port` that replaces `127.0.0.1`/`localhost` in signed URLs, for a container that cannot reach the host's loopback. Only `host.docker.internal`, `host.lima.internal`, `gateway.docker.internal`, `127.0.0.1`, `localhost` are accepted; URLs for any other host are never rewritten |
| `SIGNED_URL_ALLOWED_HOSTS` | optional comma list: signed URLs must point to one of these hosts |
| `GARMENT_GUESS_ENABLED`, `GARMENT_MODEL_VERSION`, `GARMENT_MIN_CONFIDENCE` | see above |
| `WORKER_ID`, `WORKER_RUN_LOOP` | heartbeat name (default `worker-1`); `false` serves `/health` only |

The password of `worker_role`: the role is created without one. Locally: `SPARTA_WORKER_DB_PASSWORD=<16 to 128 characters> bash supabase/scripts/set-worker-password.sh` (git-ignored script, local stack only; `--clear` removes it). Hosted: set it by hand in the dashboard. Put the resulting URL in `services/worker/.env` (git-ignored; template `.env.example`). Never commit it; never put the Supabase secret key here.

## Run

Docker (local, Colima): `cd services/worker && docker compose up --build`; stop with `docker compose down`. The image is `python:3.13-slim`, pinned by digest (LLD 7.1 says 3.11; the pinned numpy needs 3.12 or newer and the tests run on 3.13), runs as a non-root user, models are downloaded at build time (`u2netp`), the container is read-only, has no published port and `restart: always`. Without Docker: `uvicorn --factory worker.app:app_factory --host 127.0.0.1 --port 8080` inside a virtualenv with `requirements.txt`.

## Base image

The Dockerfile names its base image by digest (`python:3.13-slim@sha256:...`), so a rebuilt image starts from the same bytes until someone changes the line on purpose. To refresh it: `docker pull python:3.13-slim`, read the new digest with `docker images --digests python` (the DIGEST column of the `3.13-slim` row; it is the multi-platform index, so it is the same on every machine), put it in the `FROM` line, rebuild (`docker compose build`), run `bash workflow/gates/worker_tests.sh` and the local end-to-end check (`python services/worker/scripts/e2e_local.py`), and commit the one-line change with the date in the message. Refresh when the Python or Debian security notices name a fix; `repo_lint` (RL07) fails a `FROM` line without a digest.

## Tests

`bash workflow/gates/worker_tests.sh` (part of `gate.sh`): runs `pytest` with the virtualenv python named by `SPARTA_VENV_PYTHON` in `workflow/local.env`, or prints SKIPPED. Install into a virtualenv OUTSIDE the repository: `pip install -r requirements-dev.txt`. Tests marked `db` use the local Supabase stack as `worker_role` (the conftest sets a random password for the run and clears it afterwards) and need an empty job queue (`supabase db reset`). The one `slow` test loads the real `u2netp` model (first run downloads it, about 4 MB, to `~/.u2net`).

## Licences and sources

- `rembg` 2.0.87: MIT, https://github.com/danielgatis/rembg. Model `u2netp` (U^2-Net small): Apache-2.0, https://github.com/xuebinqin/U-2-Net, weights fetched on first use from https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx.
- Garment model v1: Fashion-MNIST (Zalando Research, MIT); see `ml/recommendation-engine/garment/model_card.md`.
- ONNX Runtime (MIT), FastAPI (MIT), psycopg (LGPL-3.0, used as a library unmodified), httpx (BSD-3), Pillow (MIT-CMU), NumPy (BSD-3), uvicorn (BSD-3).
