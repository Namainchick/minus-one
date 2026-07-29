# Minus One

Song hochladen, in 6 Instrumente zerlegen (Demucs `htdemucs_6s` via Replicate),
und im Mini-Mischpult die Spuren schalten, die deine Band heute selbst spielt.
„Music minus one" — die Band minus das Mitglied, das du ersetzt.

## Lokal starten (ohne Kosten)

    npm install
    ./scripts/make-fixture-stems.sh        # Platzhalter-Demo (braucht ffmpeg)
    MOCK_REPLICATE=1 NEXT_PUBLIC_MOCK_UPLOAD=1 npm run dev

## Lokaler Modus (jeden Song ohne Cloud zerlegen)

Demucs muss lokal installiert sein:

    uv tool install --python 3.12 --with "numpy<2" demucs

Danach den lokalen Modus mit beiden benötigten Env-Flags über das Convenience-Skript starten:

    npm run dev:local

Die Trennung dauert auf Apple Silicon ungefähr 1–2 Minuten pro Song. Dieser Modus
funktioniert nur lokal auf diesem Mac; die deployte Version verwendet weiterhin Replicate.
Jobs und Uploads existieren nur im laufenden Dev-Prozess (nach einem Neustart sind sie weg); temporäre Dateien werden automatisch bereinigt (Uploads nach 1 h, Stems nach 24 h).

Der YouTube-Import ist nur im lokalen Modus verfügbar; das Feld erscheint auch nur dort. Er braucht `yt-dlp` (`brew install yt-dlp`), ist für die private Nutzung gedacht und akzeptiert Videos bis maximal 7 Minuten.

## Tests

    npm test          # Vitest (Validierung, Limits, Replicate-Mapping, API-Routen)
    npm run test:e2e  # Playwright (Demo-Flow + Upload-Flow, alles gemockt)

## Echten Demo-Song einspielen (einmalig, lizenzfreier Track!)

    scripts/prepare-demo.sh pfad/zum/song.mp3 "Songtitel"

(demucs wird über pipx oder ein venv installiert — das Skript erklärt es, falls es fehlt.)

## Deploy (Vercel + RunPod)

1. Vercel-Projekt anlegen, Repository verbinden und einen öffentlichen Blob-Store verknüpfen.
2. Upstash Redis anlegen (kostenloser Tarif) und mit Preview sowie Production verbinden.
3. Den Worker aus `services/runpod-demucs/` als queue-basierten RunPod Serverless Endpoint deployen.
4. Server-only Env-Vars setzen (siehe `.env.example`):
   - `SEPARATION_PROVIDER=runpod`
   - `RUNPOD_API_KEY`
   - `RUNPOD_ENDPOINT_ID`
   - `BLOB_READ_WRITE_TOKEN`
   - beide Upstash-Variablen
   - `CRON_SECRET`
5. Lokale und Mock-Flags in Production nicht setzen.
6. Preview deployen und einen echten Upload bis zu sechs abspielbaren Spuren testen.
7. Erst nach erfolgreichem Smoke-Test bei RunPod `Max workers = 2` und für niedrige Latenz `Active workers = 1` setzen.

Replicate bleibt als Rollback verfügbar: `SEPARATION_PROVIDER=replicate` plus
`REPLICATE_API_TOKEN` und `REPLICATE_DEMUCS_VERSION` aktivieren den bisherigen Pfad.

## E2E-Zeit messen

Für einen realen Lauf werden getrennt gemessen: Blob-Upload, Validierung und RunPod-Start,
RunPod `delayTime`, RunPod `executionTime`, Polling-Overhead und Laden der sechs Stem-Dateien.
Der Browser gilt erst als fertig, wenn der Player sichtbar ist und alle sechs MP3s geladen wurden.

## Checkliste vor dem ersten Zeigen (manuell)

- [ ] Echter Upload-Durchlauf gegen RunPod in Desktop Chrome
- [ ] Sechs Stem-Dateien sind abspielbar und gleich lang
- [ ] Demo-Flow auf iPhone-Safari (Play, Kanal schalten, Fader, Seek)
- [ ] Rate-Limit greift (4. Upload in einer Stunde → freundliche Box)
- [ ] RunPod-Ausgabenlimit und Worker-Obergrenze sind gesetzt
- [ ] Echter Demo-Song (lizenzfrei) statt Platzhalter-Töne eingespielt
