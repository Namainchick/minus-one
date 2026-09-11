# RunPod CUDA Image and Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the locally verified Demucs worker as a reproducible `linux/amd64` CUDA image and prepare a zero-active-worker RunPod endpoint deployment through the private GitHub repository.

**Architecture:** Build from the digest-pinned official PyTorch 2.13 CUDA 12.6 runtime, install only pinned worker dependencies and ffmpeg, cache `htdemucs_6s` under fixed `/opt/models` paths, and start the existing RunPod handler. Static tests protect the image contract; RunPod's GitHub integration performs the authoritative repo-root `linux/amd64` build because the local OrbStack VM is damaged and resetting it would destroy unrelated Docker data.

**Tech Stack:** Docker BuildKit, PyTorch 2.13, CUDA 12.6, Demucs 4.1, RunPod Serverless GitHub integration, pytest, Ruff.

---

## File Structure

- `services/runpod-demucs/Dockerfile`: Production CUDA worker image.
- `.dockerignore`: Repo-root allowlist for RunPod's fixed repository build context.
- `services/runpod-demucs/tests/test_image_contract.py`: Static image-contract tests that fail before the Dockerfile exists.
- `services/runpod-demucs/README.md`: Build, local container inspection, and exact RunPod console setup.
- `docs/superpowers/plans/2026-07-29-runpod-cuda-endpoint.md`: Execution checklist and deployment boundary.

### Task 1: Add failing image-contract tests

**Files:**
- Create: `services/runpod-demucs/tests/test_image_contract.py`
- Test: `services/runpod-demucs/Dockerfile`
- Test: `.dockerignore`

- [x] **Step 1: Write Dockerfile contract tests**

The tests read the Dockerfile as text and require these production invariants:

```python
def test_cuda_image_contract():
    dockerfile = (SERVICE_ROOT / "Dockerfile").read_text()
    assert "@sha256:" in dockerfile.splitlines()[0]
    assert "pip install --no-cache-dir --break-system-packages" in dockerfile
    assert 'HF_HOME="/opt/models/huggingface"' in dockerfile
    assert 'TORCH_HOME="/opt/models/torch"' in dockerfile
    assert 'Separator(model="htdemucs_6s", device="cpu")' in dockerfile
    assert 'CMD ["python", "-u", "handler.py"]' in dockerfile


def test_repo_root_context_is_an_allowlist():
    dockerignore = (REPO_ROOT / ".dockerignore").read_text().splitlines()
    assert dockerignore[0] == "*"
    assert "!services/runpod-demucs/Dockerfile" in dockerignore
    assert "!services/runpod-demucs/requirements.txt" in dockerignore
    assert "!services/runpod-demucs/worker.py" in dockerignore
    assert "!services/runpod-demucs/handler.py" in dockerignore
```

Also assert that the image copies only `requirements.txt`, `worker.py`, and `handler.py`, and does not contain `ARG`, `BLOB_READ_WRITE_TOKEN`, `RUNPOD_API_KEY`, or a recursive `COPY .`.

- [x] **Step 2: Run the tests and verify RED**

Run:

```bash
cd services/runpod-demucs
uv run --python 3.12 --with-requirements requirements-dev.txt pytest -q tests/test_image_contract.py
```

Expected: FAIL because the Dockerfile and root `.dockerignore` do not exist.

### Task 2: Implement the CUDA image

**Files:**
- Create: `services/runpod-demucs/Dockerfile`
- Create: `.dockerignore`
- Test: `services/runpod-demucs/tests/test_image_contract.py`

- [x] **Step 1: Create a minimal production Dockerfile**

Use this structure:

```dockerfile
FROM pytorch/pytorch:2.13.0-cuda12.6-cudnn9-runtime@sha256:6acf597eeb8e376a96580dde4952f37cc017fef732bb40bfc73f28f25e3f64b4

ENV DEMUCS_DEVICE="cuda" \
    HF_HOME="/opt/models/huggingface" \
    TORCH_HOME="/opt/models/torch"

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates
COPY services/runpod-demucs/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt \
    && pip check \
    && python -c 'import torch; assert torch.__version__ == "2.13.0+cu126"; assert torch.version.cuda == "12.6"'
RUN python -c 'from pathlib import Path; from demucs.api import Separator; Separator(model="htdemucs_6s", device="cpu"); assert any(p.is_file() for root in (Path("/opt/models/huggingface"), Path("/opt/models/torch")) for p in root.rglob("*"))'
COPY services/runpod-demucs/worker.py services/runpod-demucs/handler.py ./
CMD ["python", "-u", "handler.py"]
```

The model-cache command uses CPU only because RunPod's GitHub builders do not expose GPUs.

- [x] **Step 2: Create a strict root `.dockerignore`**

RunPod builds from the repository root. Begin with `*`, re-open only the `services/runpod-demucs/` directory chain, then allow only `Dockerfile`, `requirements.txt`, `worker.py`, and `handler.py`. No env file, test, demo MP3, documentation, or Git metadata reaches the builder.

- [x] **Step 3: Run contract tests and Ruff**

Run:

```bash
uv run --python 3.12 --with-requirements requirements-dev.txt pytest -q
uv run --python 3.12 --with-requirements requirements-dev.txt ruff check .
```

Expected: all Python and image-contract tests pass.

### Task 3: Use RunPod's amd64 builder as the authoritative image test

**Context:** OrbStack could not start because its internal VM data partition is missing. Resetting OrbStack would delete all local Docker data, so Nam explicitly approved skipping that destructive repair. RunPod's GitHub builder is the authoritative `linux/amd64` build instead.

**Files:**
- Verify: `services/runpod-demucs/Dockerfile`
- Verify: `services/runpod-demucs/requirements.txt`

- [x] **Step 1: Verify dependencies resolve before the remote build**

Run from `services/runpod-demucs`:

```bash
uv pip compile --python-version 3.12 --python-platform x86_64-unknown-linux-gnu requirements.txt --output-file /tmp/minus-one-runpod-requirements.lock
```

Expected: all pinned direct dependencies resolve without conflicts.

- [x] **Step 2: Push the image source to the private GitHub repository**

Push the current feature branch after tests and review pass. No registry credentials are needed because RunPod clones the private repository through its GitHub integration.

- [x] **Step 3: Build and inspect through RunPod**

In RunPod, select the pushed branch and `services/runpod-demucs/Dockerfile`. The **Builds** tab must reach `Completed`; its logs must show the `htdemucs_6s cached` build step. The resulting worker must pass RunPod's startup test before any active workers are enabled.

Evidence: the first build exposed an incompatible preinstalled `spin` package and was fixed by commit `f10c7b4`. The next build completed. Async smoke job `90c4d744-240d-4764-a5a2-75e1080f0ee8-e1` started the worker after 75,836 ms and reached the expected controlled `FAILED` state in 101 ms with `WorkerInputError` for the deliberately invalid non-Blob URL.

### Task 4: Document and prepare the real RunPod endpoint

**Files:**
- Modify: `services/runpod-demucs/README.md`

- [x] **Step 1: Document GitHub deployment**

Add exact instructions:

1. Push the current branch to `https://github.com/Namainchick/minus-one`.
2. In RunPod Settings → Connections, connect GitHub and grant access only to the private `minus-one` repository.
3. Create a new Serverless endpoint using **Import Git Repository**.
4. Select the pushed branch and Dockerfile path `services/runpod-demucs/Dockerfile`.
5. Choose **Queue** endpoint type.
6. Select 4090 PRO primary, L4/A5000/3090 first fallback, and A4000/A4500/RTX 4000 second fallback.
7. Initially configure active workers `0`, max workers `1`, execution timeout `600` seconds, job TTL `3600` seconds, request-count scaler `1`, and FlashBoot enabled.
8. Do not add permanent Blob credentials to RunPod.

- [x] **Step 2: Explain the first endpoint gate**

Document that endpoint creation/build can happen now, but the first real job waits for the Vercel provider integration to generate six scoped Blob upload tokens. After that smoke test passes, max workers becomes `2` and active workers becomes `1`.

- [x] **Step 3: Run all local gates**

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

- [x] **Step 4: Commit the image slice**

```bash
git add services/runpod-demucs docs/superpowers/plans/2026-07-29-runpod-cuda-endpoint.md
git commit -m "feat: package RunPod worker as CUDA image"
```

## Manual External Checkpoint

The endpoint cannot be created headlessly without authorizing RunPod to the private GitHub repository. After the image slice is committed and pushed, Nam completes the RunPod GitHub authorization in the browser. The agent then verifies build logs and endpoint settings before any active worker is enabled.
