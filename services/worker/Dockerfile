# Sparta worker (LLD 7.1). Build context: services/worker. No secret is ever copied into the image: configuration comes from the environment.
# Python 3.13, not the 3.11 of LLD 7.1: the pinned numpy 2.5.4 (the version the tests ran with) needs Python 3.12 or newer.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 U2NET_HOME=/opt/u2net NUMBA_CACHE_DIR=/tmp/numba
WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt \
 && useradd --system --no-create-home --uid 10001 worker \
 && mkdir -p /opt/u2net && chown worker /opt/u2net

# Models are pre-downloaded in the image build (LLD 7.1): rembg's u2netp (Apache-2.0, https://github.com/danielgatis/rembg, weights from
# https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx). The garment model is committed in models/.
USER worker
RUN python -c "from rembg import new_session; new_session('u2netp')"

COPY --chown=worker worker ./worker
COPY --chown=worker models ./models

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).status == 200 else 1)"
# 127.0.0.1 inside the container and no published port: /health is reachable only from inside (LLD 7.1)
CMD ["uvicorn", "--factory", "worker.app:app_factory", "--host", "127.0.0.1", "--port", "8080"]
