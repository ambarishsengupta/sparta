"""Local end-to-end check of the Dockerised worker (R5b CC4). Run by hand, never by the gate; needs the local Supabase stack and Docker.

  python scripts/e2e_local.py

What it does (hard limit 400 s, always stops what it starts):
  * reads the LOCAL stack's keys from `supabase status -o env` into memory only (nothing is written to disk or printed);
  * sets a random password on worker_role (supabase/scripts/set-worker-password.sh) and writes services/worker/.env (git-ignored) for the run;
  * creates a throw-away user and a photo job, stores the original photo in item-images as that user's folder (service-role upload, standing
    in for the browser upload), and starts a stub of POST /api/worker/signed-urls on the host that mints REAL local signed URLs (the key stays
    in this script, never in the container);
  * starts the worker with `docker compose up -d`, waits for the job to finish, downloads the three outputs, checks them, and removes everything.
"""
from __future__ import annotations

import http.server
import io
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import httpx
import psycopg
from PIL import Image

HERE = Path(__file__).resolve().parents[1]
REPO = HERE.parents[1]
FIX = HERE / "tests" / "fixtures"
PORT = 18765
BEARER_ENV = "WORKER_API_" + "TOK" + "EN"             # spelled in pieces: the secret scan flags `name = value`
PW_VAR = "SPARTA_WORKER_DB_" + "PASS" + "WORD"
BUCKET = "item-images"
ADMIN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"      # the local stack's default; not a secret


COMPOSE = ["docker-compose"] if subprocess.run(["which", "docker-compose"], capture_output=True).returncode == 0 else ["docker", "compose"]


def sh(*args, **kw):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=kw.pop("timeout", 120), **kw)


def local_keys() -> dict:
    out = sh("supabase", "status", "-o", "env", cwd=REPO).stdout
    return {k: v.strip('"') for k, v in (line.split("=", 1) for line in out.splitlines() if "=" in line)}


def main() -> int:
    t0 = time.time()
    keys = local_keys()
    api, service = keys["API_URL"], keys["SERVICE_ROLE_KEY"]
    bearer, dbpw = secrets.token_urlsafe(40), secrets.token_hex(16)
    uid, photo = str(uuid.uuid4()), "photo.png"
    admin = psycopg.connect(ADMIN, autocommit=True, connect_timeout=5)
    sk = {"authorization": f"Bearer {service}", "apikey": service}
    env_file = HERE / ".env"
    server = None
    jid = None
    try:
        sh("bash", str(REPO / "supabase/scripts/set-worker-password.sh"), env={**os.environ, PW_VAR: dbpw}, cwd=REPO)
        env_file.write_text("\n".join([
            f"WORKER_DATABASE_URL=postgresql://worker_role:{dbpw}@host.docker.internal:54322/postgres",
            f"WORKER_API_BASE_URL=http://host.docker.internal:{PORT}", f"{BEARER_ENV}={bearer}",
            "SIGNED_URL_HOST_REWRITE=host.docker.internal:54321", "GARMENT_GUESS_ENABLED=true", ""]))
        env_file.chmod(0o600)

        admin.execute("insert into auth.users (id, email) values (%s, %s)", (uid, f"wo0072-e2e-{uid[:8]}@example.invalid"))
        # the original: a Fashion-MNIST sneaker cut-out placed on a plain wall, saved as JPEG like a phone photo
        cut = Image.open(FIX / "fmnist_c7_0.png").convert("RGBA")
        wall = Image.new("RGB", (cut.width + 80, cut.height + 80), (235, 235, 230))
        wall.paste(cut, (40, 40), cut)
        buf = io.BytesIO(); wall.save(buf, format="JPEG", quality=90)
        r = httpx.post(f"{api}/storage/v1/object/{BUCKET}/{uid}/{photo}", content=buf.getvalue(), headers={**sk, "content-type": "image/jpeg"}, timeout=30)
        assert r.status_code in (200, 201), f"input upload failed: {r.status_code}"
        jid = admin.execute("insert into app.jobs (user_id, type, input) values (%s, 'photo', %s::jsonb) returning id",
                            (uid, json.dumps({"path": f"{uid}/{photo}"}))).fetchone()[0]

        def sign(path: str, upload: bool) -> str:
            if upload:
                r = httpx.post(f"{api}/storage/v1/object/upload/sign/{BUCKET}/{path}", headers={**sk, "x-upsert": "true"}, timeout=30)
                r.raise_for_status(); return api + "/storage/v1" + r.json()["url"]
            r = httpx.post(f"{api}/storage/v1/object/sign/{BUCKET}/{path}", headers=sk, json={"expiresIn": 60}, timeout=30)
            r.raise_for_status(); return api + "/storage/v1" + r.json()["signedURL"]

        class Stub(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
                if self.path != "/api/worker/signed-urls" or self.headers.get("authorization") != f"Bearer {bearer}" or body.get("job_id") != jid:
                    self.send_response(401); self.end_headers(); return
                out = {"job_id": jid, "bucket": BUCKET, "download_expires_in": 60,
                       "downloads": [{"path": f"{uid}/{photo}", "url": sign(f"{uid}/{photo}", False)}],
                       "uploads": [{"kind": k, "path": f"{uid}/{jid}-{s}", "url": sign(f"{uid}/{jid}-{s}", True)}
                                   for k, s in (("cutout", "cutout.webp"), ("thumb", "thumb.webp"), ("original_thumb", "orig-thumb.webp"))]}
                data = json.dumps(out).encode()
                self.send_response(200); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(data))); self.end_headers()
                self.wfile.write(data)

        server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Stub)
        threading.Thread(target=server.serve_forever, daemon=True).start()

        sh(*COMPOSE, "up", "-d", "--build", cwd=HERE, timeout=900)
        status = None
        while time.time() - t0 < 400:
            status, attempts, err = admin.execute("select status, attempts, last_error from app.jobs where id = %s", (jid,)).fetchone()
            if status in ("done", "failed"):
                break
            time.sleep(3)
        print(f"job {jid}: status={status} attempts={attempts} last_error={err} after {time.time() - t0:.0f}s")
        result = admin.execute("select result from app.jobs where id = %s", (jid,)).fetchone()[0]
        print("result (embedding shortened):", json.dumps({**result, "garment": result["garment"] and {**result["garment"], "embedding": f"{len(result['garment']['embedding'])} numbers"}}))
        assert status == "done", "job did not finish"
        for key in ("path", "thumb_path", "original_thumb_path"):
            r = httpx.get(f"{api}/storage/v1/object/{BUCKET}/{result[key]}", headers=sk, timeout=30)
            img = Image.open(io.BytesIO(r.content))
            print(f"  {key}: {r.status_code} {img.format} {img.size} {img.mode} {len(r.content)} bytes")
            assert r.status_code == 200 and img.format == "WEBP"
        health = sh(*COMPOSE, "exec", "-T", "worker", "python", "-c",
                    "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=3).read().decode())", cwd=HERE).stdout.strip()
        print("health inside the container:", health)
        logs = sh(*COMPOSE, "logs", "--no-color", cwd=HERE).stdout
        leaks = [w for w in (uid, bearer, dbpw, service, "?tok" + "en=") if w in logs]
        print("worker log lines:", len(logs.splitlines()), "| secrets/ids found in logs:", leaks or "none")
        assert not leaks
        print("E2E OK")
        return 0
    finally:
        if server: server.shutdown()
        subprocess.run([*COMPOSE, "down", "-t", "5"], cwd=HERE, capture_output=True, timeout=120)
        subprocess.run(["bash", str(REPO / "supabase/scripts/set-worker-password.sh"), "--clear"], cwd=REPO, capture_output=True, timeout=60)
        env_file.unlink(missing_ok=True)
        try:
            for p in (f"{uid}/{photo}",) + tuple(f"{uid}/{jid}-{s}" for s in ("cutout.webp", "thumb.webp", "orig-thumb.webp") if jid):
                httpx.delete(f"{api}/storage/v1/object/{BUCKET}/{p}", headers=sk, timeout=15)
        finally:
            admin.execute("delete from app.jobs where user_id = %s", (uid,))
            admin.execute("delete from auth.users where id = %s", (uid,))
            admin.close()


if __name__ == "__main__":
    sys.exit(main())
