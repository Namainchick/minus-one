FROM pytorch/pytorch:2.13.0-cuda12.6-cudnn9-runtime@sha256:6acf597eeb8e376a96580dde4952f37cc017fef732bb40bfc73f28f25e3f64b4

ENV PYTHONUNBUFFERED="1" \
    PIP_DISABLE_PIP_VERSION_CHECK="1" \
    DEMUCS_DEVICE="cuda" \
    HF_HOME="/opt/models/huggingface" \
    TORCH_HOME="/opt/models/torch"

WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY services/runpod-demucs/requirements.txt ./requirements.txt
RUN pip uninstall --yes --break-system-packages spin \
    && pip install --no-cache-dir --break-system-packages -r requirements.txt \
    && pip check \
    && python -c 'import torch; assert torch.__version__ == "2.13.0+cu126", torch.__version__; assert torch.version.cuda == "12.6", torch.version.cuda'

RUN mkdir -p "$HF_HOME" "$TORCH_HOME" \
    && python -c 'from pathlib import Path; from demucs.api import Separator; Separator(model="htdemucs_6s", device="cpu"); roots=(Path("/opt/models/huggingface"), Path("/opt/models/torch")); files=[p for root in roots for p in root.rglob("*") if p.is_file()]; assert files, "model cache is empty"; print("htdemucs_6s cached", [str(p) for p in files])'

COPY services/runpod-demucs/worker.py services/runpod-demucs/handler.py ./

CMD ["python", "-u", "handler.py"]
