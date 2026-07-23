#!/usr/bin/env bash
# Nutzung: scripts/prepare-demo.sh <song.mp3|song.wav> "Songtitel"
# Zerlegt einen lizenzfreien Song lokal mit Demucs und legt die Stems nach public/demo/.
set -euo pipefail
cd "$(dirname "$0")/.."
IN="${1:?Nutzung: prepare-demo.sh <datei> \"Titel\"}"
TITLE="${2:-Demo}"
command -v demucs >/dev/null || pip3 install demucs
demucs -n htdemucs_6s --mp3 --mp3-bitrate 192 -o /tmp/minus-one-demo "$IN"
BASE="/tmp/minus-one-demo/htdemucs_6s/$(basename "${IN%.*}")"
mkdir -p public/demo
for s in vocals drums bass guitar piano other; do cp "$BASE/$s.mp3" "public/demo/$s.mp3"; done
printf '{ "title": "%s" }\n' "$TITLE" > public/demo/meta.json
echo "OK: Demo-Song '$TITLE' liegt in public/demo/."
