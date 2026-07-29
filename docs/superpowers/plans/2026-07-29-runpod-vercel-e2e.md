# RunPod Vercel End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing Next.js app to the verified RunPod worker, deploy a Vercel preview with Vercel Blob, and measure the complete upload-to-playable-stems duration.

**Architecture:** Add a RunPod adapter behind a provider facade while preserving Replicate, local Demucs, and the mock provider. Vercel generates six exact-path scoped Blob tokens and submits only URLs/tokens to RunPod. Existing same-origin routes continue to hide provider credentials and proxy completed stems; Vercel CLI creates and links the project/store and deploys a preview for the first real test.

**Tech Stack:** Next.js 16.2 Node.js Route Handlers, TypeScript, Vitest, `@vercel/blob` 2.6, RunPod queue API, Vercel CLI 54.9, Playwright.

---

## File Structure

- `lib/runpod.ts`: RunPod request/response types, scoped Blob token generation, start/status/stem operations, retries, and validation.
- `lib/separation.ts`: Explicit provider facade for `replicate | runpod`, with local jobs handled before remote dispatch.
- `lib/timing.ts`: Shared processing timeout and polling interval constants.
- `tests/runpod.test.ts`: Request shape, token constraints, status mapping, retries, and malformed output tests.
- `tests/separation.test.ts`: Provider-selection and local-job routing tests.
- `tests/timing.test.ts`: Twelve-minute timeout regression test.
- `app/api/separate/route.ts`: Import provider facade instead of Replicate directly.
- `app/api/jobs/[id]/route.ts`: Import provider facade instead of Replicate directly.
- `app/api/stems/[jobId]/[stem]/route.ts`: Import provider facade instead of Replicate directly.
- `app/page.tsx`: Use shared twelve-minute timeout and three-second polling interval.
- `.env.example`: Document RunPod/provider variables without secrets.
- `README.md`: Document Vercel + RunPod deployment and E2E timing procedure.

### Task 1: Add failing RunPod adapter tests

**Files:**
- Create: `tests/runpod.test.ts`
- Test: `lib/runpod.ts`

- [x] **Step 1: Write the desired RunPod contract tests**

Mock `@vercel/blob/client` and global `fetch`. Tests must prove:

```ts
expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledTimes(6);
expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledWith({
  pathname: expect.stringMatching(/^runpod\/[0-9a-f-]+\/vocals\.mp3$/),
  allowedContentTypes: ["audio/mpeg"],
  maximumSizeInBytes: 20 * 1024 * 1024,
  addRandomSuffix: false,
  allowOverwrite: true,
  validUntil: expect.any(Number),
});
```

The `/run` request must use the configured endpoint, Bearer key, ten-second timeout, six upload specs, and policies `executionTimeout: 600000` and `ttl: 3600000`.

Status tests cover:

- `IN_QUEUE → queued`;
- `IN_PROGRESS|RUNNING → processing`;
- `COMPLETED → done` with six `/api/stems/{jobId}/{stem}` proxy URLs;
- `FAILED|CANCELLED|TIMED_OUT → failed`;
- missing stems, non-Blob output URLs, malformed output, unknown states, and invalid job IDs fail closed;
- idempotent status GET retries at most twice for `429`/`5xx` while `/run` is never retried.

- [x] **Step 2: Run and verify RED**

Run:

```bash
npx vitest run tests/runpod.test.ts
```

Expected: FAIL because `lib/runpod.ts` does not exist.

### Task 2: Implement the RunPod adapter

**Files:**
- Create: `lib/runpod.ts`
- Test: `tests/runpod.test.ts`

- [x] **Step 1: Implement strict environment and URL helpers**

Require `RUNPOD_API_KEY` and `RUNPOD_ENDPOINT_ID`. Build URLs only under `https://api.runpod.ai/v2/{endpointId}`. Accept output URLs only when they use HTTPS and a hostname ending in `.public.blob.vercel-storage.com`.

- [x] **Step 2: Generate six scoped output tokens and submit asynchronously**

Use `crypto.randomUUID()` for the output path. Generate one token per canonical `STEMS` entry with the exact constraints from Task 1 and one-hour validity. POST to `/run` once, validate the response job ID with the existing `isValidJobId`, and return only that ID.

- [x] **Step 3: Implement status retrieval and mapping**

GET `/status/{id}` with bounded retries on status `429` and `5xx` using 250-ms and 500-ms delays. Map provider states to the existing `JobStatus`. Require six valid output Blob URLs and a valid `inputUrl` on completion.

- [x] **Step 4: Implement stem source lookup**

Return a completed stem's validated Blob URL or `null` for incomplete/failed jobs. Never return arbitrary URLs from RunPod output.

- [x] **Step 5: Run tests and verify GREEN**

Run:

```bash
npx vitest run tests/runpod.test.ts
```

Expected: all RunPod adapter tests pass.

### Task 3: Add the provider facade and migrate routes

**Files:**
- Create: `lib/separation.ts`
- Create: `tests/separation.test.ts`
- Modify: `app/api/separate/route.ts`
- Modify: `app/api/jobs/[id]/route.ts`
- Modify: `app/api/stems/[jobId]/[stem]/route.ts`
- Modify: `tests/separate-route.test.ts`
- Modify: `tests/jobs-route.test.ts`
- Modify: `tests/stems-route.test.ts`

- [x] **Step 1: Write failing provider-selection tests**

Mock `lib/replicate`, `lib/runpod`, and local job helpers. Assert:

- default and `SEPARATION_PROVIDER=replicate` use Replicate;
- `SEPARATION_PROVIDER=runpod` uses RunPod for start/status/stems;
- local job IDs always use local status/stream handling before provider selection;
- unknown provider values throw a clear configuration error.

- [x] **Step 2: Implement `lib/separation.ts`**

Expose the same three methods routes already use:

```ts
startSeparation(audioUrl: string): Promise<string>;
getJob(id: string): Promise<JobStatus>;
getStemSourceUrl(id: string, stem: StemName): Promise<string | null>;
```

Re-export `JobStatus`. Keep `MOCK_REPLICATE=1` working through the default Replicate path.

- [x] **Step 3: Migrate route imports and mocks**

Change only provider imports from `@/lib/replicate` to `@/lib/separation`. Preserve Node runtime, existing input validation, local Demucs paths, response shapes, and same-origin proxying.

- [x] **Step 4: Run focused route and provider tests**

Run:

```bash
npx vitest run tests/separation.test.ts tests/separate-route.test.ts tests/jobs-route.test.ts tests/stems-route.test.ts
```

Expected: all focused tests pass.

### Task 4: Align client timing and deployment configuration

**Files:**
- Create: `lib/timing.ts`
- Create: `tests/timing.test.ts`
- Modify: `app/page.tsx`
- Modify: `.env.example`
- Modify: `README.md`

- [x] **Step 1: Write the failing timing test**

Require:

```ts
expect(PROCESSING_TIMEOUT_MS).toBe(12 * 60 * 1000);
expect(JOB_POLL_INTERVAL_MS).toBe(3000);
```

- [x] **Step 2: Move timing constants and update polling**

Create `lib/timing.ts`, import both constants in `app/page.tsx`, and replace the current hard-coded five-minute timeout and three-second interval.

- [x] **Step 3: Document server-only environment variables**

Add:

```text
SEPARATION_PROVIDER=runpod
RUNPOD_API_KEY=
RUNPOD_ENDPOINT_ID=
```

Do not prefix secrets with `NEXT_PUBLIC_`. Document Replicate as rollback configuration and local/mock flags as non-production only.

- [x] **Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/timing.test.ts tests/runpod.test.ts tests/separation.test.ts
```

Expected: all focused tests pass.

### Task 5: Verify and commit the application integration

**Files:**
- All files from Tasks 1–4.

- [x] **Step 1: Run full local quality gates**

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

Expected: all tests pass. The known Next.js file-tracing warning may remain but must not fail the build.

- [x] **Step 2: Request focused code review**

Review provider secrets, scoped-token constraints, retry/idempotency behavior, SSRF/output URL validation, route boundaries, local/mock compatibility, and test coverage. Fix all Critical/Important findings.

- [x] **Step 3: Commit and push**

```bash
git add lib app tests .env.example README.md docs/superpowers/plans/2026-07-29-runpod-vercel-e2e.md
git commit -m "feat: connect app to RunPod separation"
git push origin feature/minus-one-v1
```

### Task 6: Create and configure Vercel resources with CLI

**External resources:**
- Vercel project: `minus-one`
- Public Blob store: `minus-one`

- [x] **Step 1: Create and link the Vercel project**

```bash
npx vercel projects add minus-one
npx vercel link --yes --project minus-one
```

Expected: `.vercel/project.json` exists and remains git-ignored.

- [x] **Step 2: Create and connect the Blob store**

```bash
npx vercel blob create-store minus-one \
  --access public \
  --region fra1 \
  --yes \
  --environment production \
  --environment preview \
  --environment development
```

Expected: the store is connected to the linked project and supplies `BLOB_READ_WRITE_TOKEN` to all three environments.

- [x] **Step 3: Add preview and production configuration without printing secrets**

Use the RunPod key from macOS Keychain and pipe values into `vercel env add`. Configure `SEPARATION_PROVIDER`, `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`, `DAILY_SEPARATION_LIMIT`, and a generated `CRON_SECRET` for preview and production. Never pass the RunPod key as a command-line argument or print it.

- [x] **Step 4: Pull development env locally**

```bash
npx vercel env pull .env.local --environment development --yes
```

Expected: `.env.local` contains Blob configuration and stays ignored. RunPod credentials remain in Keychain and are injected only into the dev-server process.

### Task 7: Deploy preview and measure real end-to-end timing

**Artifacts:**
- Preview deployment URL
- Timing result for `tests/fixtures/tiny.m4a`
- Six downloaded MP3 stems

- [x] **Step 1: Deploy a preview**

```bash
npx vercel deploy --yes
```

Expected: deployment reaches Ready and returns an HTTPS preview URL.

- [x] **Step 2: Run a real browser upload**

Use Playwright against the preview URL. Upload `tests/fixtures/tiny.m4a`, capture timestamps for upload start, processing start, player visible, and all six stem downloads complete. Record browser console/network failures.

- [x] **Step 3: Capture RunPod provider metrics**

Use the returned job ID and securely stored API key to retrieve `delayTime` and `executionTime`. Correlate:

```text
blobUploadMs
validationAndSubmitMs
runpodDelayMs
runpodExecutionMs
statusPollingOverheadMs
stemLoadMs
totalUploadToPlayerMs
```

- [x] **Step 4: Validate outputs**

Download all six same-origin stem endpoints, run `ffprobe`, and require positive equal durations and valid MP3 decoding.

- [x] **Step 5: Report the measured result and remaining production gate**

Report exact timings. Preview may use in-memory limits; production deployment remains blocked until Upstash Redis is connected, because production intentionally refuses to run without shared rate limits.

Measured preview evidence (`tests/fixtures/tiny.m4a`, job `ca5d83e0-ee06-4b46-ab17-2a22afce5cbb-u2`): Blob upload plus validation/submission 1,934 ms; RunPod delay 16 ms; RunPod execution 3,992 ms; upload-to-player 10,258 ms; complete validation downloads 13,544 ms. All six outputs decode as distinct 191,999-bit/s MP3 files with equal 2.063667-second duration.
