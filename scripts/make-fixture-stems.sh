#!/usr/bin/env bash
# Erzeugt 6 Ton-Spuren als Demo-Platzhalter (bis ein echter Song eingespielt wird).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v ffmpeg >/dev/null || { echo "ffmpeg fehlt: brew install ffmpeg"; exit 1; }
mkdir -p public/demo
stems=(vocals drums bass guitar piano other)
freqs=(440 220 110 330 550 660)
for i in "${!stems[@]}"; do
  ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=${freqs[$i]}:duration=20" \
    -codec:a libmp3lame -b:a 128k "public/demo/${stems[$i]}.mp3"
done
printf '{ "title": "PLATZHALTER-TÖNE (echten Demo-Song mit prepare-demo.sh einspielen)" }\n' > public/demo/meta.json
echo "OK: public/demo/ gefüllt."
