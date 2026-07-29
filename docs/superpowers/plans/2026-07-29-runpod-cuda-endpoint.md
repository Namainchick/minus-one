# RunPod CUDA Image and Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the locally verified Demucs worker as a reproducible `linux/amd64` CUDA image and prepare a zero-active-worker RunPod endpoint deployment through the private GitHub repository.

**Architecture:** Build from the official PyTorch 2.13 CUDA 12.6 runtime, install only pinned worker dependencies and ffmpeg, cache `htdemucs_6s` weights during the image build, and start the existing RunPod handler. Test Dockerfile invariants first, then build and inspect the amd64 image locally; the final endpoint creation uses RunPod's GitHub integration because it can build a private repository without a separate public registry.

**Tech Stack:** Docker BuildKit, PyTorch 2.13, CUDA 12.6, Demucs 4.1, RunPod Serverless GitHub integration, pytest, Ruff.

---

## File Structure

- `services/runpod-demucs/Dockerfile`: Production CUDA worker image.
- `services/runpod-demucs/.dockerignore`: Minimal worker build context.
- `services/runpod-demucs/tests/test_image_contract.py`: Static image-contract tests that fail before the Dockerfile exists.
- `services/runpod-demucs/README.md`: Build, local container inspection, and exact RunPod console setup.
- `docs/superpowers/plans/2026-07-29-runpod-cuda-endpoint.md`: Execution checklist and deployment boundary.

### Task 1: Add failing image-contract tests

**Files:**
- Create: `services/runpod-demucs/tests/test_image_contract.py`
- Test: `services/runpod-demucs/Dockerfile`
- Test: `services/runpod-demucs/.dockerignore`

- [ ] **Step 1: Write Dockerfile contract tests**

The tests read the Dockerfile as text and require these production invariants:

```python
def test_cuda_image_contract():
    dockerfile = Path("Dockerfile").read_text()
    assert dockerfile.startswith("FROM pytorch/pytorch:2.13.0-cuda12.6-cudnn9-runtime")
    assert "apt-get install" in dockerfile and "ffmpeg" in dockerfile
    assert "pip install --no-cache-dir -r requirements.txt" in dockerfile
    assert 'ENV DEMUCS_DEVICE="cuda"' in dockerfile
    assert 'Separator(model="htdemucs_6s", device="cpu")' in dockerfile
    assert 'CMD ["python", "-u", "handler.py"]' in dockerfile


def test_image_never_copies_secrets_or_tests():
    dockerignore = Path(".dockerignore").read_text().splitlines()
    assert ".env*" in dockerignore
    assert "tests/" in dockerignore
    assert "smoke-output/" in dockerignore
```

Also assert that the image copies only `requirements.txt`, `worker.py`, and `handler.py`, and does not contain `ARG`, `BLOB_READ_WRITE_TOKEN`, `RUNPOD_API_KEY`, or a recursive `COPY .`.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
cd services/runpod-demucs
uv run --python 3.12 --with-requirements requirements-dev.txt pytest -q tests/test_image_contract.py
```

Expected: FAIL because the Dockerfile and `.dockerignore` do not exist.

### Task 2: Implement the CUDA image

**Files:**
- Create: `services/runpod-demucs/Dockerfile`
- Create: `services/runpod-demucs/.dockerignore`
- Test: `services/runpod-demucs/tests/test_image_contract.py`

- [ ] **Step 1: Create a minimal production Dockerfile**

Use this structure:

```dockerfile
FROM pytorch/pytorch:2.13.0-cuda12.6-cudnn9-runtime

ENV PYTHONUNBUFFERED="1" \
    PIP_DISABLE_PIP_VERSION_CHECK="1" \
    DEMUCS_DEVICE="cuda"

WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py handler.py ./

RUN python -c 'from demucs.api import Separator; Separator(model="htdemucs_6s", device="cpu"); print("htdemucs_6s cached")'

CMD ["python", "-u", "handler.py"]
```

The model-cache command uses CPU only because RunPod's GitHub builders do not expose GPUs.

- [ ] **Step 2: Create a strict `.dockerignore`**

Ignore Git metadata, all env files, documentation, tests, caches, local virtual environments, smoke outputs, and developer-only requirement files. The build context retains only the Dockerfile and the four production files it references.

- [ ] **Step 3: Run contract tests and Ruff**

Run:

```bash
uv run --python 3.12 --with-requirements requirements-dev.txt pytest -q
uv run --python 3.12 --with-requirements requirements-dev.txt ruff check .
```

Expected: all Python and image-contract tests pass.

### Task 3: Build and inspect the amd64 image locally

**Files:**
- Modify if evidence requires: `services/runpod-demucs/Dockerfile`
- Modify if evidence requires: `services/runpod-demucs/requirements.txt`

- [ ] **Step 1: Start the local Docker runtime**

Start OrbStack and wait until `docker info` succeeds. Do not use shell backgrounding; manage any long-running startup through the process harness or the macOS application launcher.

- [ ] **Step 2: Build the exact RunPod target platform**

Run from `services/runpod-demucs`:

```bash
docker build \
  --platform linux/amd64 \
  --tag minus-one-runpod-demucs:local \
  .
```

Expected: BuildKit completes, pinned dependencies install, and the model-cache step prints `htdemucs_6s cached`.

- [ ] **Step 3: Inspect platform, dependencies, and baked model**

Run:

```bash
docker image inspect minus-one-runpod-demucs:local \
  --format 'os={{.Os}} arch={{.Architecture}} size={{.Size}}'

docker run --rm --platform linux/amd64 --entrypoint python \
  minus-one-runpod-demucs:local \
  -c 'import torch, demucs, runpod, pathlib; p=list(pathlib.Path("/root/.cache/torch/hub/checkpoints").glob("*")); print(torch.__version__, len(p), [x.name for x in p])'
```

Expected: `linux/amd64`, PyTorch `2.13.0`, and at least one cached checkpoint file.

- [ ] **Step 4: Verify the handler can initialize without CUDA for local inspection**

Run:

```bash
docker run --rm --platform linux/amd64 \
  -e DEMUCS_DEVICE=cpu \
  --entrypoint python \
  minus-one-runpod-demucs:local \
  -c 'import handler; print(type(handler._SEPARATOR).__name__)'
```

Expected: `DemucsSeparator`. This checks image imports and model loading; it intentionally does not benchmark emulated amd64 CPU audio separation.

### Task 4: Document and prepare the real RunPod endpoint

**Files:**
- Modify: `services/runpod-demucs/README.md`

- [ ] **Step 1: Document GitHub deployment**

Add exact instructions:

1. Push the current branch to `https://github.com/Namainchick/minus-one`.
2. In RunPod Settings → Connections, connect GitHub and grant access only to the private `minus-one` repository.
3. Create a new Serverless endpoint using **Import Git Repository**.
4. Select the pushed branch and Dockerfile path `services/runpod-demucs/Dockerfile`.
5. Choose **Queue** endpoint type.
6. Select 4090 PRO primary, L4/A5000/3090 first fallback, and A4000/A4500/RTX 4000 second fallback.
7. Initially configure active workers `0`, max workers `1`, execution timeout `600` seconds, job TTL `3600` seconds, request-count scaler `1`, and FlashBoot enabled.
8. Do not add permanent Blob credentials to RunPod.

- [ ] **Step 2: Explain the first endpoint gate**

Document that endpoint creation/build can happen now, but the first real job waits for the Vercel provider integration to generate six scoped Blob upload tokens. After that smoke test passes, max workers becomes `2` and active workers becomes `1`.

- [ ] **Step 3: Run all local gates**

Run:

```bash
cd services/runpod-demucs
uv run --python 3.12 --with-requirements requirements-dev.txt pytest -q
uv run --python 3.12 --with-requirements requirements-dev.txt ruff check .
cd ../..
npm test
npm run lint
npm run build
```

Expected: every command exits successfully. The existing Next.js file-tracing warning may remain but must not fail the build.

- [ ] **Step 4: Commit the image slice**

```bash
git add services/runpod-demucs docs/superpowers/plans/2026-07-29-runpod-cuda-endpoint.md
git commit -m "feat: package RunPod worker as CUDA image"
```

## Manual External Checkpoint

The endpoint cannot be created headlessly without authorizing RunPod to the private GitHub repository. After the image slice is committed and pushed, Nam completes the RunPod GitHub authorization in the browser. The agent then verifies build logs and endpoint settings before any active worker is enabled.
