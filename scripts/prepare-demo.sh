#!/usr/bin/env bash
# Nutzung: scripts/prepare-demo.sh <song.mp3|song.wav> "Songtitel"
# Zerlegt einen lizenzfreien Song lokal mit Demucs und legt die Stems nach public/demo/.
set -euo pipefail
cd "$(dirname "$0")/.."
IN="${1:?Nutzung: prepare-demo.sh <datei> \"Titel\"}"
TITLE="${2:-Demo}"
if ! command -v demucs >/dev/null; then
  echo "demucs fehlt. Installation z. B. mit:"
  echo "  pipx install demucs"
  echo "  (oder: python3 -m venv ~/.demucs-venv && ~/.demucs-venv/bin/pip install demucs && export PATH=\"\$HOME/.demucs-venv/bin:\$PATH\")"
  exit 1
fi
demucs -n htdemucs_6s --mp3 --mp3-bitrate 192 -o /tmp/minus-one-demo "$IN"
BASE="/tmp/minus-one-demo/htdemucs_6s/$(basename "${IN%.*}")"
mkdir -p public/demo
for s in vocals drums bass guitar piano other; do cp "$BASE/$s.mp3" "public/demo/$s.mp3"; done
python3 -c 'import json,sys; print(json.dumps({"title": sys.argv[1]}))' "$TITLE" > public/demo/meta.json
echo "OK: Demo-Song '$TITLE' liegt in public/demo/."
