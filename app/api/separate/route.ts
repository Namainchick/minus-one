import { NextResponse } from "next/server";
import { checkRateLimit, consumeDailyBudget, defaultCounter } from "@/lib/limits";
import { ipFromRequest } from "@/lib/request";
import { startSeparation } from "@/lib/replicate";
import { validateAudioBuffer } from "@/lib/validation";
import { MAX_FILE_BYTES } from "@/lib/stems";

export const runtime = "nodejs";

const MOCK_UPLOAD_URL = "mock://upload";

function isAllowedBlobUrl(url: string): boolean {
  if (process.env.MOCK_REPLICATE === "1" && url === MOCK_UPLOAD_URL) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** Liest den Body nur bis maxBytes; null = zu groß. Schutz vor Speicher-DoS. */
async function readBodyCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) return null;
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
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
