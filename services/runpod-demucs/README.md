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

## CUDA image

The production image uses PyTorch 2.13 with CUDA 12.6 and cuDNN 9. The base image is pinned by digest. It installs ffmpeg and pinned Python dependencies, then stores the `htdemucs_6s` weights under `/opt/models` during the build. RunPod therefore does not need to download the model when an active worker starts.

Optional local build on a machine with a working Docker runtime:

```bash
docker build \
  --platform linux/amd64 \
  --file services/runpod-demucs/Dockerfile \
  --tag minus-one-runpod-demucs:local \
  .
```

Inspect the resulting image without requiring a local NVIDIA GPU:

```bash
docker image inspect minus-one-runpod-demucs:local \
  --format 'os={{.Os}} arch={{.Architecture}} size={{.Size}}'

docker run --rm --platform linux/amd64 \
  -e DEMUCS_DEVICE=cpu \
  --entrypoint python \
  minus-one-runpod-demucs:local \
  -c 'import handler; print(type(handler._SEPARATOR).__name__)'
```

## Deploy through RunPod GitHub integration

The repository is private, so RunPod's GitHub integration is the simplest deployment path. RunPod clones the selected branch, builds the Dockerfile, stores the image in its own registry, and deploys it without Docker Hub credentials.

1. Push the desired branch to `https://github.com/Namainchick/minus-one`.
2. Open [RunPod Settings](https://console.runpod.io/user/settings), find **Connections**, and connect GitHub.
3. Grant RunPod access only to the private `minus-one` repository.
4. Open [RunPod Serverless](https://console.runpod.io/serverless), choose **New Endpoint**, then **Import Git Repository**.
5. Select the pushed branch and set the Dockerfile path to `services/runpod-demucs/Dockerfile`.
6. Select the **Queue** endpoint type.
7. Use 4090 PRO as the preferred GPU category, L4/A5000/3090 as the first fallback, and A4000/A4500/RTX 4000 as the second fallback.
8. Initially set active workers to `0`, max workers to `1`, request-count scaler to `1`, execution timeout to `600` seconds, job TTL to `3600` seconds, and keep FlashBoot enabled.
9. Do not add `BLOB_READ_WRITE_TOKEN` or any other permanent Blob credential to RunPod.

RunPod uses the repository root as Docker build context; the root `.dockerignore` sends only the Dockerfile and three production worker files. RunPod shows progress under the endpoint's **Builds** tab. The build must reach **Completed**, and its logs must contain `htdemucs_6s cached`. RunPod allows 30 minutes for `docker build` and 160 minutes for the entire build/upload/test process. If the Docker build exceeds 30 minutes, the fallback is a prebuilt image in a container registry.

Before adding Blob credentials or enabling an active worker, use the endpoint's **Requests** tab with this deliberately invalid request:

```json
{
  "input": {
    "audioUrl": "https://example.com/not-a-vercel-blob.mp3",
    "uploads": {}
  }
}
```

The job must start the CUDA worker and then finish as `FAILED` with the controlled Vercel-Blob validation error. Check the cold-start logs: they must not show a Hugging Face or Torch model download.

The first real separation job waits for the Vercel provider integration, which creates six short-lived, pathname-scoped Blob upload tokens. After one real song completes and all six outputs are playable, increase max workers to `2` and active workers to `1` for predictable low latency.

A normal branch push does not update an existing GitHub-backed endpoint automatically. For later worker updates, create a GitHub release; RunPod uses that release to trigger a new build. RunPod's **Builds** tab can roll back to a previous completed image.
