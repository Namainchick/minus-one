# Minus One

Upload a song, get it split into six instrument stems on a GPU, and mute the one you play.
"Music minus one": the band minus the member you are replacing tonight.

Live: https://minus-one-nine.vercel.app

## What it does

- Takes an MP3, WAV or M4A and splits it into **vocals, drums, bass, guitar, piano and rest**
  with Demucs (`htdemucs_6s`).
- Runs the separation on a **serverless GPU worker** (RunPod) behind a provider interface, with
  Replicate as a second backend for fallback.
- Plays all six stems **in sync** in the browser through a Web Audio gain graph, with a fader
  and a mute switch per track, coordinated seeking, and drift correction whenever two tracks
  drift more than 40 ms apart.
- Keeps the pipeline honest: one-hour scoped upload tokens, same-origin stem proxying, rate
  limits, a daily GPU budget, and cleanup jobs (uploads after 1 h, stems after 24 h).

About ten seconds from upload to a playable mixer when the GPU worker is warm.

## Run it locally (free, mocked)

```bash
npm install
./scripts/make-fixture-stems.sh                      # placeholder demo stems, needs ffmpeg
MOCK_REPLICATE=1 NEXT_PUBLIC_MOCK_UPLOAD=1 npm run dev
```

## Local mode: split any song on your own machine

Demucs has to be installed locally:

```bash
uv tool install --python 3.12 --with "numpy<2" demucs
npm run dev:local
```

Separation takes about one to two minutes per song on Apple Silicon. This mode only works on
the local machine; the deployed version keeps using the cloud worker. Jobs and uploads live only
inside the running dev process and are gone after a restart.

The YouTube import exists only in local mode (the field is hidden otherwise). It needs `yt-dlp`
(`brew install yt-dlp`), is meant for private use, and accepts videos up to seven minutes.

## Tests

```bash
npm test          # Vitest: validation, limits, provider mapping, API routes
npm run test:e2e  # Playwright: demo flow and upload flow, everything mocked
```

## Real demo song (once, use a licence-free track)

```bash
scripts/prepare-demo.sh path/to/song.mp3 "Song title"
```

The script installs Demucs through pipx or a venv and explains what to do if something is missing.

## Deploy (Vercel + RunPod)

1. Create the Vercel project, connect the repo, attach a public Blob store.
2. Create an Upstash Redis database (free tier) and connect it to Preview and Production.
3. Deploy the worker in `services/runpod-demucs/` as a queue-based RunPod Serverless endpoint.
4. Set the server-only env vars (see `.env.example`): `SEPARATION_PROVIDER=runpod`,
   `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`, `BLOB_READ_WRITE_TOKEN`, both Upstash variables,
   `CRON_SECRET`.
5. Never set the local or mock flags in production.
6. Deploy a preview and test one real upload all the way to six playable tracks.
7. Only after that smoke test, set `Max workers = 2` on RunPod and `Active workers = 1` for low
   latency.

Replicate stays available as a rollback: `SEPARATION_PROVIDER=replicate` plus
`REPLICATE_API_TOKEN` and `REPLICATE_DEMUCS_VERSION` switch back to the old path.

## How the end-to-end time is measured

A real run is timed in parts: blob upload, validation and RunPod start, RunPod `delayTime`,
RunPod `executionTime`, polling overhead, and loading the six stem files. The browser counts as
done only when the player is visible and all six MP3s have loaded.

## Stack

Next.js 16 · TypeScript · Web Audio API · Demucs (PyTorch) · RunPod Serverless · Vercel Blob ·
Upstash Redis · Vitest · Playwright

## Status

Live and used for band practice. Built spring 2026.
