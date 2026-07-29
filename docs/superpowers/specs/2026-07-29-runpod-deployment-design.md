# RunPod Deployment Design

**Date:** 2026-07-29

## Goal

Host the public Minus One application with predictable, fast GPU separation while using existing RunPod credits. Vercel remains the public application host. RunPod replaces Replicate only for Demucs execution; Render is not needed.

## Production Architecture

The production system has four managed parts:

1. **Vercel** hosts the Next.js application and all browser-facing API routes.
2. **Vercel Blob** stores the uploaded source song and the six generated MP3 stems temporarily.
3. **Upstash Redis** provides shared rate limits and the daily separation budget.
4. **RunPod Serverless** runs a custom Demucs worker on an NVIDIA GPU.

The browser communicates only with the same-origin Vercel application. It never receives the RunPod API key or Vercel Blob read-write token and never calls RunPod directly.

## Request Flow

1. The browser uploads the source file directly to Vercel Blob through the existing scoped upload-token route.
2. `POST /api/separate` downloads and validates the source exactly as it does now.
3. The Vercel API creates six destination pathnames and six short-lived Vercel Blob client tokens, each restricted to one MP3 pathname.
4. The API submits an asynchronous RunPod job through `POST https://api.runpod.ai/v2/{endpointId}/run`.
5. The RunPod worker downloads the source from its public Vercel Blob URL, runs `htdemucs_6s`, encodes the six stems as 192-kbit/s MP3 files, and uploads each result with its scoped token.
6. The browser continues polling the existing `GET /api/jobs/{id}` route. Vercel translates RunPod statuses into the application's existing `queued`, `processing`, `done`, and `failed` statuses. The client processing timeout increases from five to twelve minutes so it covers the ten-minute worker timeout plus status polling.
7. When complete, the existing stem proxy streams the six Blob URLs through the same origin. The original source is deleted. The existing cron later removes old output blobs.

The RunPod `/run` payload contains URLs and scoped credentials, not audio bytes. This remains below RunPod's 10-MB asynchronous request limit.

## Provider Boundary

A provider facade will own the remote separation contract:

```ts
type JobStatus =
  | { status: "queued" | "processing" }
  | { status: "failed"; error?: string }
  | { status: "done"; stems: Record<StemName, string>; inputUrl?: string };

startSeparation(audioUrl: string): Promise<string>;
getJob(id: string): Promise<JobStatus>;
getStemSourceUrl(id: string, stem: StemName): Promise<string | null>;
```

`SEPARATION_PROVIDER=runpod|replicate` selects the remote provider explicitly. Replicate remains available as a fallback and for rollback; the default remains `replicate` so an incomplete environment cannot silently send jobs to a different provider. Local Demucs and the current test mock remain unchanged.

The existing API routes import the facade rather than `lib/replicate.ts` directly. No provider-specific response reaches the browser.

## RunPod API Mapping

Starting a job uses:

```http
POST https://api.runpod.ai/v2/{RUNPOD_ENDPOINT_ID}/run
Authorization: Bearer {RUNPOD_API_KEY}
Content-Type: application/json
```

The request body is:

```json
{
  "input": {
    "audioUrl": "https://…public.blob.vercel-storage.com/source.mp3",
    "uploads": {
      "vocals": {
        "pathname": "runpod/<output-id>/vocals.mp3",
        "token": "<scoped Vercel Blob client token>"
      }
    }
  },
  "policy": {
    "executionTimeout": 600000,
    "ttl": 3600000
  }
}
```

All six stems are included in `uploads`. Status checks use `GET https://api.runpod.ai/v2/{endpointId}/status/{jobId}`.

RunPod states map as follows:

- `IN_QUEUE` becomes `queued`.
- `IN_PROGRESS` and `RUNNING` become `processing`.
- `COMPLETED` becomes `done` only if all six validated stem URLs exist.
- `FAILED`, `CANCELLED`, and `TIMED_OUT` become `failed`.
- Unknown states fail closed rather than pretending completion.

A successful worker result contains `inputUrl` and a six-entry `stems` object. RunPod retains asynchronous results for 30 minutes; the existing five-minute browser polling window retrieves them well inside that limit.

## Scoped Blob Uploads

The full `BLOB_READ_WRITE_TOKEN` remains only on Vercel. For each output pathname, Vercel calls `generateClientTokenFromReadWriteToken` from `@vercel/blob/client` with:

- the exact destination pathname;
- `allowedContentTypes: ["audio/mpeg"]`;
- `maximumSizeInBytes: 20 * 1024 * 1024`, enough for a seven-minute 192-kbit/s MP3 stem;
- `addRandomSuffix: false`;
- `allowOverwrite: true`, so a retried RunPod job is idempotent;
- `validUntil: Date.now() + 60 * 60 * 1000`, matching the one-hour job TTL;
- a private payload containing no reusable storage credentials.

The Python worker uploads each MP3 to the Vercel Blob control endpoint with the scoped token, API version 12, the token's store ID, public access, and `audio/mpeg`. It accepts only the normalized Blob response fields and returns the resulting public URL.

If one upload fails, the worker job fails. Already uploaded files are harmless and are removed by the existing cleanup cron.

## RunPod Worker

The repository will contain a focused worker directory with:

- a CUDA-compatible Dockerfile;
- pinned Python dependencies for RunPod, PyTorch, Demucs, audio encoding, and HTTP requests;
- `handler.py` for validation, download, separation, upload, and cleanup;
- worker unit tests that do not require a GPU;
- local test input and deployment instructions.

The `htdemucs_6s` separator is initialized once outside the handler and moved to CUDA. This avoids reloading model weights for each song. Each job receives its own temporary directory, validates the source host and download size, and removes temporary input and output files in a `finally` block.

A worker processes one separation job at a time. Concurrent Demucs runs on one GPU are intentionally disabled until benchmarking shows sufficient memory and throughput.

## RunPod Endpoint Configuration

The initial production endpoint uses:

- a queue-based Serverless endpoint;
- one GPU per worker;
- one active worker to eliminate cold starts;
- two maximum workers for limited parallelism;
- request-count autoscaling with scaler value 1;
- 4090 PRO as the preferred GPU category;
- L4/A5000/3090 as the first fallback category;
- A4000/A4500/RTX 4000 as the second fallback category;
- FlashBoot enabled;
- a ten-minute execution timeout;
- a one-hour job TTL;
- no network volume, because model files are baked into the image and songs use object storage.

RunPod documents active workers as continuously billed. At the documented 4090 PRO rate of $0.00031 per second, one always-active worker is about $1.12 per hour. The active-worker count can be changed to zero when predictable first-request latency is no longer worth the continuous credit usage.

## Environment Variables

Vercel requires:

```text
SEPARATION_PROVIDER=runpod
RUNPOD_API_KEY=
RUNPOD_ENDPOINT_ID=
BLOB_READ_WRITE_TOKEN=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
CRON_SECRET=
DAILY_SEPARATION_LIMIT=20
```

Replicate variables remain optional rollback configuration. Local and mock flags must not be enabled in the production build.

The RunPod worker does not receive the full Blob token. Its normal operation requires no permanent storage secret because every job carries narrowly scoped, expiring upload tokens.

## Error Handling and Security

- Vercel start and status calls to RunPod use a ten-second response timeout.
- The non-idempotent `/run` start request is never retried automatically. Idempotent status requests retry at most twice after `429` or `5xx`, with 250-ms and 500-ms delays.
- RunPod `401`, `404`, exhausted `429`, and exhausted `5xx` responses become controlled provider errors.
- The worker accepts only HTTPS source URLs under `*.public.blob.vercel-storage.com`, preventing arbitrary server-side URL fetching.
- Source downloads retain the application's 15-MB hard limit and a 30-second timeout. Each output upload has a 60-second timeout.
- Output URLs must also belong to the expected Vercel Blob hostname before they are exposed through the proxy.
- The RunPod key is server-only and never placed in a `NEXT_PUBLIC_*` variable.
- `CRON_SECRET` is mandatory in production so cleanup cannot be triggered publicly.
- Logs contain job IDs and stages but not API keys or scoped upload tokens.

## Testing

Tests cover each boundary separately:

1. Provider tests verify RunPod request URLs, authorization, payloads, status mapping, missing stems, malformed outputs, and controlled errors.
2. Blob-token tests verify one exact pathname per stem, MP3-only constraints, size limits, overwrite behavior, and explicit expiry.
3. Route tests prove local, mock, Replicate, and RunPod selection without exposing provider responses.
4. Client tests verify the twelve-minute processing timeout and unchanged three-second polling interval.
5. Worker tests mock source download, Demucs execution, Blob uploads, partial failure, retry overwrite, and temporary-file cleanup.
6. A manual RunPod smoke test separates one short fixture and verifies six playable outputs.
7. Existing Vitest, lint, production build, and Playwright suites remain required gates.

## Deployment Sequence

1. Build and locally test the RunPod worker image.
2. Publish the image through RunPod's GitHub integration or a container registry.
3. Create the queue-based endpoint with zero active workers and perform a short fixture smoke test.
4. Benchmark A4000-class, L4/A5000/3090-class, and 4090-class workers on the same song.
5. Select the fastest acceptable tier, then set one active worker.
6. Create and connect Vercel Blob and Upstash resources.
7. Set Vercel production environment variables and deploy the application.
8. Run one real end-to-end upload, confirm output cleanup, then enable public access.

## Non-goals

This change does not introduce Render, a custom database-backed queue, direct browser-to-RunPod requests, or permanent user libraries. It does not remove Replicate until the RunPod path has been benchmarked and proven in production.

## Official References

- RunPod Serverless endpoint settings: https://docs.runpod.io/serverless/endpoints/endpoint-configurations
- RunPod asynchronous requests and status: https://docs.runpod.io/serverless/endpoints/send-requests
- RunPod handler functions and payload limits: https://docs.runpod.io/serverless/workers/handler-functions
- RunPod endpoint optimization: https://docs.runpod.io/serverless/development/optimization
- RunPod Serverless pricing: https://docs.runpod.io/serverless/pricing
- RunPod storage options: https://docs.runpod.io/serverless/storage/overview
