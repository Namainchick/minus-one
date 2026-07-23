# Minus One — Design-Dokument

**Datum:** 2026-07-23
**Status:** Vom Nutzer freigegeben (Brainstorming-Session 23.07.2026)
**Projektordner:** `~/code/minus-one`

**Zum Namen:** „Music minus one" ist ein etablierter Begriff für Aufnahmen, bei denen
genau ein Instrument fehlt, damit man es selbst spielen kann — exakt der
Anwendungsfall dieser App.

## 1. Ziel und Kontext

Nam spielt in einer Band. Manchmal fehlt bei der Probe der Drummer, der Bassist, der
Sänger oder die Main-Melodie. Die App löst das: Man lädt einen Song hoch (MP3/WAV),
die App zerlegt ihn in seine Instrumenten-Spuren ("Stems"), und im Player schaltet
man die Instrumente an oder aus, die man selbst übernehmen will.

Zweitziel: Das Projekt ist ein vorzeigbares, deploytes Portfolio-Stück. Ein Besucher
(z. B. Recruiter) muss ohne Vorbereitung innerhalb von Sekunden den Kern erleben
können. UX-Anspruch: alles fließend, keine toten Enden, direkt testbar.

Vorarbeit: Nam hat die Stem-Trennung bereits per CLI mit Metas Open-Source-Modell
(Demucs) getestet. Dieses Modell wird auch hier verwendet, nur gehostet.

## 2. Entschiedene Anforderungen

| Thema | Entscheidung |
|---|---|
| Nutzungsmodell | Einmal-Session: hochladen, spielen, fertig. Keine Speicherung, keine Accounts, keine Bibliothek. |
| Stems | 6 Spuren via Demucs `htdemucs_6s`: Gesang, Schlagzeug, Bass, Gitarre, Klavier, Rest. Bekannte Schwäche: Gitarre/Klavier trennen hörbar schlechter als die anderen vier — akzeptiert. |
| Hauptflow | Eigenen Song hochladen. Zusätzlich ein vorgeladener, fertig zerlegter Demo-Song für Besucher, die nicht warten wollen. |
| Player | Mini-Mischpult: Play/Pause, Zeitleiste zum Spulen, pro Instrument ein An/Aus-Schalter und ein Lautstärke-Fader. Loop-Funktion bewusst NICHT in v1 (spätere Ausbaustufe). |
| GPU-Hosting | Replicate (Demucs fertig gehostet, Abrechnung pro Song, ca. 2–8 Cent, keine Grundgebühr). |
| Web-Hosting | Vercel (kostenlos), eine Next.js-Codebase für Seite + API. |
| Design | Weißer Grund, spielerisch statt clean: "Gig-Poster-Brutalismus". Keine Emojis im UI. |
| Kostenschutz | Mehrschichtig (siehe Abschnitt 7), damit ein Angriff maximal das selbst gesetzte Limit kostet und die Demo trotzdem weiterläuft. |

## 3. UX: Eine Seite, drei Zustände

Keine Unterseiten, keine Navigation. Der eine Screen verwandelt sich:

### Zustand 1 — Start
- Großer Plakat-Titel ("MINUS ONE"), Unterzeile "Zerleg deinen Song · Schalte deine Band".
- Kleiner schräg gestellter Badge "Built for my band" (erzählt die Entstehungsgeschichte).
- Zwei Wege nebeneinander:
  - **Upload-Fläche** (Drag & Drop + Dateiauswahl): "MP3 oder WAV hier reinwerfen".
    Limits stehen ehrlich dran: max. 15 MB, max. 7 Minuten, dauert ~1 Minute.
  - **Demo-Knopf** (rot, prominent): "Keine Lust zu warten? Demo-Song laden" —
    lädt sofort den vorbereiteten Song in den Player.

### Zustand 2 — Verarbeitung (nur beim Upload, ~30–90 Sek.)
- Fortschrittsbalken im Poster-Stil.
- Rotierende spielerische Statuszeilen, z. B. "Sänger wird vom Mikro getrennt",
  "Isoliere den Schlagzeuger…", "Bassist wird gesucht (wie immer)".
  Hier lebt der Band-Humor — im Text, nicht in Emojis.
- Ehrliche Restzeit-Schätzung.
- Hinweis, dass man währenddessen den Demo-Song hören kann.

### Zustand 3 — Player
- **Transportleiste:** großer quadratischer Play/Pause-Knopf, Songtitel, Laufzeit,
  dicke Zeitleiste zum Spulen.
- **Mischpult:** 6 Kanäle nebeneinander (Gesang, Drums, Bass, Gitarre, Klavier, Rest).
  Pro Kanal: Name, An/Aus-Schalter mit LED (gedrückt = an), vertikaler Lautstärke-Fader.
  Jeder Kanal hat eine eigene Akzentfarbe.
- **Ausgeschalteter Kanal:** wird grau, Name durchgestrichen, darunter der Vermerk
  "DU SPIELST!" — das ist der erzählerische Kern (Instrument fehlt, weil man es
  selbst übernimmt).
- **Mobil:** Kanäle stapeln sich in zwei Reihen à drei; Transport bleibt oben.

### Fehlerzustände (alle im selben Poster-Ton, alle mit Demo-Song als Ausweg)
| Fall | Verhalten |
|---|---|
| Datei zu groß / falsches Format / zu lang | Poster-Box erklärt das Limit, Upload-Fläche bleibt aktiv. |
| Rate-Limit erreicht (pro IP) | Poster-Box mit Wartezeit-Hinweis, Demo-Knopf prominent. |
| Tagesbudget aufgebraucht | Upload deaktiviert mit ehrlicher Erklärung ("Tagesbudget aufgebraucht — probier den Demo-Song"). Demo funktioniert immer. |
| Replicate-Fehler oder Timeout (Abbruch nach 5 Min.) | Entschuldigung, Knopf "Nochmal versuchen", Demo-Knopf daneben. |
| Netzwerkfehler beim Stems-Laden | Retry-Knopf pro Ladevorgang. |

## 4. Design-Sprache

- **Richtung:** Gig-Poster-Brutalismus auf weißem Grund. Dicke schwarze Rahmen
  (3px), harte Versatz-Schatten (4–5px, kein Blur), knallige Akzentfarben
  (Gelb `#FFDE00`, Rot `#FF4911`, Grün `#2ECC71`, Violett `#A78BFA`, Blau `#3B82F6`),
  Elemente gelegentlich leicht rotiert.
- **Typografie:** Archivo Black (Headlines, Uppercase), Space Grotesk (UI-Text).
- **Feinschliff-Option (aus dem Brainstorming):** An/Aus-Schalter dürfen sich an
  Gitarrenpedale anlehnen (LED, gedrückt-Zustand), aber im harten Poster-Look.
- **Keine Emojis.** Ikonografie, falls nötig, aus echten Icon-Sets
  (Phosphor Icons; ggf. neobrutalism.dev als Komponenten-Referenz).
- Mockups aus der Brainstorming-Session liegen unter
  `.superpowers/brainstorm/*/content/` (design-richtung.html, player-layout.html).

## 5. Architektur

**Stack:** Next.js (App Router, TypeScript, Tailwind CSS) auf Vercel.
Upstash Redis (kostenloser Tarif) für Rate-Limit + Tageszähler.
Vercel Blob für temporäre Uploads. Replicate für Demucs.

### Datenfluss beim Upload
1. Browser prüft Datei grob vor (Typ, Größe) — nur für schnelles Feedback.
2. Browser lädt die Datei **direkt** zu Vercel Blob hoch (Client-Upload mit
   serverseitig ausgestelltem Token). Grund: Vercel-API-Routen akzeptieren nur
   ~4,5 MB Request-Body, die Datei darf aber 15 MB haben.
3. Browser ruft `POST /api/separate` mit der Blob-URL auf. Die Route prüft
   serverseitig: Rate-Limit, Tagesbudget, Dateityp, Dateigröße, Songlänge
   (Metadaten-Parsing der ersten Bytes). Dann startet sie die Replicate-Prediction
   (Modell: Demucs `htdemucs_6s`) und antwortet mit einer Job-ID.
4. Browser pollt `GET /api/jobs/[id]` alle 3 Sekunden. Die Route fragt den
   Replicate-Status ab und mappt ihn auf: `queued | processing | done | failed`.
5. Bei `done`: Antwort enthält die sechs Stem-URLs. Die hochgeladene Originaldatei
   wird in diesem Moment aus Vercel Blob gelöscht.
6. Stems werden über eine eigene Proxy-Route `GET /api/stems/[jobId]/[stem]`
   ausgeliefert (streamt von Replicate durch), damit Same-Origin gilt und
   CORS-Probleme mit der Audio-Engine ausgeschlossen sind. Replicate-Output-URLs
   verfallen von selbst nach ~1 Stunde — passt zur Einmal-Session, nichts bleibt liegen.

### Demo-Song
- Wird einmalig lokal auf Nams Mac mit Demucs zerlegt (Skript im Repo:
  `scripts/prepare-demo.sh`).
- Die sechs Spuren liegen als statische Dateien unter `public/demo/` (MP3, ~128–192 kbit/s).
- Lizenz-Anforderung: eigener Band-Track oder eindeutig freie Lizenz (CC0/CC-BY).
  Kein kommerzieller Song.

### API-Routen (vollständig)
| Route | Zweck |
|---|---|
| `POST /api/upload-token` | Stellt Client-Upload-Token für Vercel Blob aus (prüft vorher Rate-Limit-Vorstufe, damit Bots nicht mal Speicher füllen). |
| `POST /api/separate` | Validierung + Replicate-Start. Gibt Job-ID zurück. |
| `GET /api/jobs/[id]` | Status-Polling. |
| `GET /api/stems/[jobId]/[stem]` | Proxy-Stream der fertigen Spuren (Same-Origin). |

## 6. Audio-Engine im Browser

Kernproblem: sechs Spuren müssen dauerhaft synchron laufen, auch auf dem Handy.

- **Kein Voll-Dekodieren in den Speicher.** (Ein 4-Minuten-Song × 6 Spuren als
  rohe PCM-Daten wären ~500 MB RAM — auf Handys ein K.o.)
- Stattdessen: Jede Spur wird als Datei geladen (`fetch` → `Blob` →
  `URL.createObjectURL`) und in ein eigenes `<audio>`-Element gesteckt.
  Speicherbedarf = nur die komprimierten Dateien (~30 MB gesamt).
- Alle sechs `<audio>`-Elemente hängen per `MediaElementAudioSourceNode` an einer
  gemeinsamen Web-Audio-Graph: pro Spur ein `GainNode` (Fader), dann Summenausgang.
- **An/Aus** = Gain auf 0 bzw. Fader-Wert, mit ~15 ms Rampe gegen Knackser.
  Der Schalter ist also stumm schalten, nicht Datei entladen — Umschalten ist verzögerungsfrei.
- **Synchronisation:** Spur 1 ist Taktgeber. Alle 500 ms Drift-Check; weicht eine
  Spur > 40 ms ab, wird ihre `currentTime` korrigiert. Seek: alle pausieren,
  `currentTime` setzen, gemeinsam fortsetzen.
- **Autoplay-Policy:** `AudioContext` wird erst nach der ersten Nutzer-Geste
  (Play-Klick) gestartet/resumed.
- Play ist erst aktiv, wenn alle sechs Spuren geladen sind (Ladefortschritt pro
  Kanal sichtbar im Mischpult).

## 7. Sicherheit und Kostenschutz

Ziel: Ein Angreifer kann maximal das selbst gesetzte Limit verursachen, und die
Demo bleibt auch im Angriffsfall funktionsfähig.

1. **Harte Obergrenze beim Anbieter:** Monatliches Spend-Limit im
   Replicate-Dashboard (Empfehlung: 10 €). Technische Obergrenze, unabhängig vom Code.
2. **Tagesbudget in der App:** Zähler in Upstash Redis, z. B. max. 20 Trennungen
   pro Tag. Danach antwortet `POST /api/separate` mit `budget_exhausted`, das UI
   deaktiviert den Upload freundlich, Demo läuft weiter.
3. **Rate-Limit pro IP:** Sliding Window, 3 Trennungen pro Stunde
   (Upstash Ratelimit). Greift auf `/api/upload-token` und `/api/separate`.
4. **Serverseitige Validierung** (Browser-Checks sind nur Komfort):
   MIME/Magic-Bytes (nur MP3/WAV), Größe ≤ 15 MB, Dauer ≤ 7 Min.
   (Metadaten-Parsing), sonst 422 mit klarer Fehlermeldung.
5. **Geheimnisse nur serverseitig:** `REPLICATE_API_TOKEN`, Upstash-Credentials,
   Blob-Token existieren nur als Server-Env-Vars. Der Browser spricht Replicate
   nie direkt an.
6. **Bot-Schutz (optional, hinter Feature-Flag):** Cloudflare Turnstile vor dem
   Upload-Token. Wird nur aktiviert, falls Missbrauch beobachtet wird —
   für den Start reicht 1–4.
7. **Keine Persistenz:** Original-Upload wird nach Abschluss gelöscht;
   Replicate-Outputs verfallen automatisch. Zusätzlich löscht ein täglicher
   Vercel-Cron verwaiste Blob-Dateien (Fälle, in denen der Nutzer den Tab
   während der Verarbeitung schließt).

## 8. Tests

- **Unit (Vitest):** Validierungslogik (Typ/Größe/Dauer), Rate-Limit- und
  Budget-Entscheidungen, Status-Mapping Replicate → App. Replicate und Redis
  werden gemockt.
- **E2E (Playwright):**
  - *Demo-Flow (der Wow-Moment, Pflicht vor jedem Deploy):* Seite öffnen →
    Demo laden → Play → Kanal ausschalten → prüfen, dass der zugehörige Gain 0 ist
    und der Zustand im UI stimmt → Fader bewegen → Seek.
  - *Upload-Flow:* mit gemocktem Replicate (Test-Route), inkl. Fehlerfälle
    (zu groß, Rate-Limit, Budget aufgebraucht).
- **Manuelle Checkliste vor dem ersten Zeigen:** ein echter Upload-Durchlauf
  gegen das echte Replicate, einmal Desktop (Chrome, Safari) und einmal iPhone-Safari.

## 9. Deployment

- Vercel-Projekt, Deployment per Git-Push auf `main`.
- Env-Vars: `REPLICATE_API_TOKEN`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`, `BLOB_READ_WRITE_TOKEN`,
  optional `TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
  `DAILY_SEPARATION_LIMIT` (Default 20).
- Einmalige Einrichtung: Replicate-Spend-Limit setzen, Upstash-DB anlegen,
  Demo-Stems generieren und einchecken.

## 10. Bewusst NICHT in v1 (spätere Ausbaustufen)

- Loop-Funktion ("Takt 32–48 wiederholen") für echtes Üben.
- Tempo-Änderung / Pitch-Shift.
- Wellenform-Anzeige pro Spur.
- Download der einzelnen Stems.
- Song-Bibliothek / Accounts.

## 11. Offene kleine Punkte für die Implementierungsphase

- Auswahl des konkreten Demo-Songs (Lizenz beachten, siehe 5).
- Genaue Kanal-Farbzuordnung und ob die Schalter Pedal-Optik bekommen —
  wird beim UI-Feinschliff am lebenden Prototyp entschieden.
