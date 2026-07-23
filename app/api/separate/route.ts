import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { checkRateLimit, consumeDailyBudget, defaultCounter } from "@/lib/limits";
import { getLocalUploadPath, isLocalDemucsEnabled, startLocalSeparation } from "@/lib/local-demucs";
import { readBodyCapped } from "@/lib/read-body";
import { ipFromRequest } from "@/lib/request";
import { startSeparation } from "@/lib/replicate";
import { MAX_FILE_BYTES } from "@/lib/stems";
import { validateAudioBuffer } from "@/lib/validation";

export const runtime = "nodejs";

const MOCK_UPLOAD_URL = "mock://upload";

function isAllowedBlobUrl(url: string): boolean {
  if (isLocalDemucsEnabled() && url.startsWith("local://")) return true;
  if (process.env.MOCK_REPLICATE === "1" && url === MOCK_UPLOAD_URL) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const counter = defaultCounter();
  const ip = ipFromRequest(request);

  if (!(await checkRateLimit(counter, ip))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { blobUrl?: unknown } | null;
  const blobUrl = body?.blobUrl;
  if (typeof blobUrl !== "string" || !isAllowedBlobUrl(blobUrl)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (blobUrl.startsWith("local://")) {
    const uploadPath = getLocalUploadPath(blobUrl.slice("local://".length));
    if (!uploadPath) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const buf = await readFile(uploadPath).catch(() => null);
    if (!buf) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const v = await validateAudioBuffer(buf);
    if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 422 });
    if (!(await consumeDailyBudget(counter))) {
      return NextResponse.json({ error: "budget_exhausted" }, { status: 429 });
    }
    return NextResponse.json({ jobId: startLocalSeparation(blobUrl.slice("local://".length)) });
  }

  // Im Mock-Modus (E2E/Dev ohne Blob-Store) wird der Download übersprungen.
  if (blobUrl !== MOCK_UPLOAD_URL) {
    const res = await fetch(blobUrl, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res || !res.ok) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const buf = await readBodyCapped(res, MAX_FILE_BYTES);
    if (!buf) return NextResponse.json({ error: "too_large" }, { status: 422 });
    const v = await validateAudioBuffer(buf);
    if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 422 });
  }

  if (!(await consumeDailyBudget(counter))) {
    return NextResponse.json({ error: "budget_exhausted" }, { status: 429 });
  }

  const jobId = await startSeparation(blobUrl);
  return NextResponse.json({ jobId });
}
