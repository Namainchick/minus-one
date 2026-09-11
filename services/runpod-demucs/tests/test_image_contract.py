from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
DOCKERFILE = SERVICE_ROOT / "Dockerfile"
ROOT_DOCKERIGNORE = REPO_ROOT / ".dockerignore"
BASE_IMAGE = (
    "pytorch/pytorch:2.13.0-cuda12.6-cudnn9-runtime"
    "@sha256:6acf597eeb8e376a96580dde4952f37cc017fef732bb40bfc73f28f25e3f64b4"
)


def test_image_removes_unused_incompatible_spin_before_dependency_check():
    dockerfile = DOCKERFILE.read_text()
    uninstall = "pip uninstall --yes --break-system-packages spin"
    install = "pip install --no-cache-dir --break-system-packages -r requirements.txt"
    assert uninstall in dockerfile
    assert dockerfile.index(uninstall) < dockerfile.index(install) < dockerfile.index("pip check")


def test_cuda_image_contract():
    dockerfile = DOCKERFILE.read_text()

    assert dockerfile.startswith(f"FROM {BASE_IMAGE}")
    assert "apt-get install" in dockerfile
    assert "ffmpeg" in dockerfile
    assert "ca-certificates" in dockerfile
    assert "pip install --no-cache-dir --break-system-packages -r requirements.txt" in dockerfile
    assert 'DEMUCS_DEVICE="cuda"' in dockerfile
    assert 'HF_HOME="/opt/models/huggingface"' in dockerfile
    assert 'TORCH_HOME="/opt/models/torch"' in dockerfile
    assert 'Separator(model="htdemucs_6s", device="cpu")' in dockerfile
    assert "torch.__version__ == \"2.13.0+cu126\"" in dockerfile
    assert "torch.version.cuda == \"12.6\"" in dockerfile
    assert "pip check" in dockerfile
    assert 'CMD ["python", "-u", "handler.py"]' in dockerfile


def test_repo_root_build_context_copies_only_production_worker_files():
    dockerfile = DOCKERFILE.read_text()

    assert "COPY services/runpod-demucs/requirements.txt ./requirements.txt" in dockerfile
    assert "COPY services/runpod-demucs/worker.py services/runpod-demucs/handler.py ./" in dockerfile
    assert "COPY ." not in dockerfile
    assert "BLOB_READ_WRITE_TOKEN" not in dockerfile
    assert "RUNPOD_API_KEY" not in dockerfile
    assert dockerfile.index("htdemucs_6s cached") < dockerfile.index("COPY services/runpod-demucs/worker.py")


def test_repo_root_context_sends_only_required_worker_files():
    dockerignore = ROOT_DOCKERIGNORE.read_text().splitlines()

    assert dockerignore[0] == "*"
    assert "!services/" in dockerignore
    assert "!services/runpod-demucs/" in dockerignore
    assert "!services/runpod-demucs/Dockerfile" in dockerignore
    assert "!services/runpod-demucs/requirements.txt" in dockerignore
    assert "!services/runpod-demucs/worker.py" in dockerignore
    assert "!services/runpod-demucs/handler.py" in dockerignore
    assert not any(line.startswith("!.env") for line in dockerignore)
    assert not any(line.startswith("!services/runpod-demucs/tests") for line in dockerignore)
