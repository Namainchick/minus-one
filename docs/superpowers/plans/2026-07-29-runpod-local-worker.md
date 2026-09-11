# RunPod Local Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the production-shaped RunPod Demucs worker and prove its contract and audio separation locally before creating a paid GPU endpoint.

**Architecture:** Keep RunPod orchestration in a thin `handler.py`, put download/separation/upload behavior in a testable `worker.py`, and provide a filesystem smoke-test CLI that exercises the same `DemucsSeparator` without requiring Vercel or RunPod credentials. Unit tests replace network and GPU boundaries; one real local CPU separation validates Demucs and MP3 output.

**Tech Stack:** Python 3.12, RunPod SDK 1.11, Demucs 4.1, PyTorch, requests, pytest, uv, ffmpeg.

---

## File Structure

- `services/runpod-demucs/worker.py`: Input validation, capped source download, reusable Demucs separator, scoped Blob upload, job orchestration, and cleanup.
- `services/runpod-demucs/handler.py`: Thin RunPod Serverless entrypoint that initializes one separator outside the handler.
- `services/runpod-demucs/smoke.py`: Local file-to-directory separation using the production separator implementation.
- `services/runpod-demucs/requirements.txt`: Pinned worker runtime dependencies.
- `services/runpod-demucs/requirements-dev.txt`: Test-only dependencies.
- `services/runpod-demucs/tests/test_worker.py`: Deterministic contract, security, upload, and cleanup tests.
- `services/runpod-demucs/README.md`: Exact local test commands and the boundary between local CPU tests and real RunPod GPU tests.
- `services/runpod-demucs/.gitignore`: Ignore Python caches, virtual environments, and local smoke outputs.

### Task 1: Write failing worker contract tests

**Files:**
- Create: `services/runpod-demucs/tests/test_worker.py`
- Create: `services/runpod-demucs/requirements.txt`
- Create: `services/runpod-demucs/requirements-dev.txt`
- Test: `services/runpod-demucs/worker.py`

- [x] **Step 1: Pin runtime and development dependencies**

Create `requirements.txt`:

```text
demucs==4.1.0
numpy<2
requests==2.34.2
runpod==1.11.0
```

Create `requirements-dev.txt`:

```text
-r requirements.txt
pytest==9.1.1
```

- [x] **Step 2: Write tests for the desired worker API**

The tests import these not-yet-existing names:

```python
from worker import (
    MAX_OUTPUT_BYTES,
    STEMS,
    WorkerInputError,
    process_job,
    upload_stem,
    validate_source_url,
)
```

Cover these behaviors independently:

```python
def test_rejects_non_vercel_source_url():
    with pytest.raises(WorkerInputError, match="Vercel Blob"):
        validate_source_url("https://example.com/song.mp3")


def test_process_job_returns_all_stem_urls_and_cleans_temp_dir(tmp_path):
    seen_temp_dir = None

    def fake_download(url, destination):
        destination.write_bytes(b"audio")

    class FakeSeparator:
        def separate(self, source, output_dir):
            nonlocal seen_temp_dir
            seen_temp_dir = output_dir.parent
            for stem in STEMS:
                (output_dir / f"{stem}.mp3").write_bytes(stem.encode())

    def fake_upload(path, spec):
        return f"https://store.public.blob.vercel-storage.com/{spec['pathname']}"

    output = process_job(
        valid_job_input(),
        separator=FakeSeparator(),
        download=fake_download,
        upload=fake_upload,
    )

    assert set(output["stems"]) == set(STEMS)
    assert output["inputUrl"] == valid_job_input()["audioUrl"]
    assert seen_temp_dir is not None
    assert not seen_temp_dir.exists()
```

Also test missing upload specs, an omitted output stem, output larger than 20 MB, malformed Blob output URL, exact pathname encoding, API-version/header construction, and scoped token store-ID extraction.

- [x] **Step 3: Run tests and verify RED**

Run from `services/runpod-demucs`:

```bash
uv run --python 3.12 --with pytest==9.1.1 --with requests==2.34.2 pytest -q
```

Expected: collection fails because `worker.py` does not exist.

### Task 2: Implement the tested worker core

**Files:**
- Create: `services/runpod-demucs/worker.py`
- Test: `services/runpod-demucs/tests/test_worker.py`

- [x] **Step 1: Add constants and input validation**

Define:

```python
STEMS = ("vocals", "drums", "bass", "guitar", "piano", "other")
MAX_SOURCE_BYTES = 15 * 1024 * 1024
MAX_OUTPUT_BYTES = 20 * 1024 * 1024
SOURCE_TIMEOUT_SECONDS = 30
UPLOAD_TIMEOUT_SECONDS = 60
BLOB_API_URL = "https://vercel.com/api/blob/"

class WorkerInputError(ValueError):
    pass
```

`validate_source_url()` accepts only HTTPS URLs whose hostname ends with `.public.blob.vercel-storage.com`. Upload specs must contain a non-empty exact pathname and a `vercel_blob_client_…` token with a parseable store ID.

- [x] **Step 2: Implement capped streaming download**

`download_source(url, destination, session=requests)` performs a streaming GET with the 30-second timeout. It rejects non-success responses, declared or actual bodies above 15 MB, and writes chunks without buffering the full song in memory.

- [x] **Step 3: Implement scoped Vercel Blob upload**

`upload_stem(path, spec, session=requests)` rejects files above 20 MB and sends:

```http
PUT https://vercel.com/api/blob/?pathname=<percent-encoded-pathname>
Authorization: Bearer <scoped-token>
x-api-version: 12
x-vercel-blob-store-id: <token-store-id>
x-vercel-blob-access: public
x-content-type: audio/mpeg
```

It validates the JSON response and accepts only HTTPS result URLs under `*.public.blob.vercel-storage.com`.

- [x] **Step 4: Implement one reusable Demucs separator**

`DemucsSeparator(device="cuda")` imports Demucs lazily in its constructor and creates one `demucs.api.Separator(model="htdemucs_6s", device=device)`. Its `separate(source, output_dir)` calls `separate_audio_file`, verifies all six sources, and writes each with `demucs.audio.save_audio(..., bitrate=192)`.

- [x] **Step 5: Implement job orchestration and cleanup**

`process_job(job_input, separator, download=download_source, upload=upload_stem)` validates the complete input before work starts, uses `TemporaryDirectory`, downloads once, separates once, verifies exactly six MP3 files, uploads all six, and returns:

```python
{
    "inputUrl": audio_url,
    "stems": {stem: uploaded_url for stem in STEMS},
}
```

Temporary files are removed on success and every failure path.

- [x] **Step 6: Run tests and verify GREEN**

Run:

```bash
uv run --python 3.12 --with pytest==9.1.1 --with requests==2.34.2 pytest -q
```

Expected: all worker tests pass without downloading PyTorch or requiring a GPU.

### Task 3: Add and test the RunPod entrypoint

**Files:**
- Create: `services/runpod-demucs/handler.py`
- Modify: `services/runpod-demucs/tests/test_worker.py`

- [x] **Step 1: Write a failing handler delegation test**

Mock the module separator and `process_job`, call `handler({"input": valid_job_input()})`, and assert that only the `input` object is delegated. Add a malformed-event test that expects `WorkerInputError`.

- [x] **Step 2: Run the handler tests and verify RED**

Run:

```bash
uv run --python 3.12 --with pytest==9.1.1 --with requests==2.34.2 --with runpod==1.11.0 pytest -q
```

Expected: FAIL because `handler.py` does not exist.

- [x] **Step 3: Implement the thin entrypoint**

```python
import os
import runpod
from worker import DemucsSeparator, WorkerInputError, process_job

_SEPARATOR = DemucsSeparator(device=os.environ.get("DEMUCS_DEVICE", "cuda"))

def handler(job):
    job_input = job.get("input") if isinstance(job, dict) else None
    if not isinstance(job_input, dict):
        raise WorkerInputError("RunPod input fehlt")
    return process_job(job_input, separator=_SEPARATOR)

if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
```

For tests, patch `DemucsSeparator` before importing the module so model weights are not loaded.

- [x] **Step 4: Run tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass.

### Task 4: Run one real local Demucs smoke test

**Files:**
- Create: `services/runpod-demucs/smoke.py`
- Create: `services/runpod-demucs/.gitignore`
- Create: `services/runpod-demucs/README.md`

- [x] **Step 1: Add the local smoke CLI**

`smoke.py` accepts `input`, `output`, and `--device` arguments, creates `DemucsSeparator`, separates the local file, and fails unless all six non-empty MP3 files exist. It prints each output path and elapsed duration.

- [x] **Step 2: Add local documentation and ignores**

Ignore `.venv/`, `__pycache__/`, `.pytest_cache/`, and `smoke-output/`. Document that this test validates worker code and audio output but does not measure CUDA or RunPod cold starts.

- [x] **Step 3: Run the complete Python unit suite**

Run:

```bash
cd services/runpod-demucs
uv run --python 3.12 --with pytest==9.1.1 --with requests==2.34.2 --with runpod==1.11.0 pytest -q
```

Expected: all tests pass.

- [x] **Step 4: Run real Demucs on the tiny fixture**

Run from the repository root:

```bash
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

Expected: six non-empty MP3 files named after `STEMS` and a successful elapsed-time summary.

- [x] **Step 5: Inspect outputs with ffprobe**

Run:

```bash
for file in services/runpod-demucs/smoke-output/*.mp3; do
  ffprobe -v error -show_entries format=duration -of default=nw=1 "$file"
done
```

Expected: six readable MP3 files with finite positive durations.

- [x] **Step 6: Run repository validation**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: existing application checks remain green.

- [x] **Step 7: Commit the local worker slice**

```bash
git add services/runpod-demucs docs/superpowers/plans/2026-07-29-runpod-local-worker.md
git commit -m "feat: add locally testable RunPod Demucs worker"
```

## Follow-up Gate

Do not create a paid RunPod endpoint until this local slice passes. The next step after local success is a separate deployment task: add the CUDA Dockerfile, publish an amd64 image, create the endpoint with zero active workers, run one GPU fixture, benchmark GPU classes, and only then enable one active worker.
