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

## Tests

    npm test          # Vitest (Validierung, Limits, Replicate-Mapping, API-Routen)
    npm run test:e2e  # Playwright (Demo-Flow + Upload-Flow, alles gemockt)

## Echten Demo-Song einspielen (einmalig, lizenzfreier Track!)

    scripts/prepare-demo.sh pfad/zum/song.mp3 "Songtitel"

(demucs wird über pipx oder ein venv installiert — das Skript erklärt es, falls es fehlt.)

## Deploy (Vercel)

1. Vercel-Projekt anlegen, Repo verbinden, Blob-Store verknüpfen.
2. Upstash-Redis anlegen (kostenloser Tarif), Env-Vars setzen (siehe `.env.example`).
3. Replicate-Token erzeugen und **Spend Limit setzen** (Dashboard → Billing, z. B. 10 $).
4. `REPLICATE_DEMUCS_VERSION` ermitteln:

       curl -s https://api.replicate.com/v1/models/ryan5453/demucs \
         -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
         | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['latest_version']; print('VERSION:', v['id']); props=v.get('openapi_schema',{}).get('components',{}).get('schemas',{}).get('Input',{}).get('properties',{}); print('INPUT KEYS:', list(props.keys()))"

   Den Hash als `REPLICATE_DEMUCS_VERSION` setzen. Falls die Input-Keys nicht
   `audio`/`model`/`output_format` heißen, `lib/replicate.ts` anpassen.
5. `CRON_SECRET` setzen (beliebiger langer Zufallswert), damit der tägliche
   Aufräum-Cron nicht öffentlich auslösbar ist.
6. Push auf `main` → Deploy.

## Checkliste vor dem ersten Zeigen (manuell)

- [ ] Echter Upload-Durchlauf gegen echtes Replicate (Desktop Chrome)
- [ ] Demo-Flow auf iPhone-Safari (Play, Kanal schalten, Fader, Seek)
- [ ] Rate-Limit greift (4. Upload in einer Stunde → freundliche Box)
- [ ] Replicate-Spend-Limit ist gesetzt
- [ ] Echter Demo-Song (lizenzfrei) statt Platzhalter-Töne eingespielt
