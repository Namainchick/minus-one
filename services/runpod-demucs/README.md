# RunPod Demucs Worker

This directory contains the queue-based RunPod Serverless worker for six-stem Demucs separation.

## What can be tested locally

The unit suite validates the RunPod input contract, source restrictions, capped downloads, scoped Vercel Blob uploads, output validation, and temporary-file cleanup without contacting RunPod or Vercel:

```bash
uv run --python 3.12 --with-requirements requirements-dev.txt pytest -q
uv run --python 3.12 --with-requirements requirements-dev.txt ruff check .
```

A real local CPU smoke test exercises the same `DemucsSeparator` used by the production handler:

```bash
cd ../..
uv run --python 3.12 \
  --with 'numpy<2' \
  --with demucs==4.1.0 \
  --with requests==2.34.2 \
  --with runpod==1.11.0 \
  python services/runpod-demucs/smoke.py \
  tests/fixtures/tiny.m4a \
  services/runpod-demucs/smoke-output \
  --device cpu
```

Inspect the generated files:

```bash
for file in services/runpod-demucs/smoke-output/*.mp3; do
  ffprobe -v error -show_entries format=duration -of default=nw=1 "$file"
done
```

## What this does not test

A Mac CPU test cannot measure NVIDIA CUDA performance, RunPod cold-start time, queue delay, or real scoped Blob uploads. Those require the follow-up deployment smoke test on a RunPod endpoint with zero active workers.

## Production handler

RunPod starts `handler.py`. It initializes `htdemucs_6s` once using `DEMUCS_DEVICE` (default `cuda`) and processes one job at a time. The job input contains one public Vercel Blob source URL and six exact-path, short-lived Blob upload tokens. Permanent storage credentials are never installed on the worker.
