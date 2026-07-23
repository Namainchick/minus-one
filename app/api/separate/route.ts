import { NextResponse } from "next/server";
import { checkRateLimit, consumeDailyBudget, defaultCounter } from "@/lib/limits";
import { ipFromRequest } from "@/lib/request";
import { startSeparation } from "@/lib/replicate";
import { validateAudioBuffer } from "@/lib/validation";

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
    const res = await fetch(blobUrl);
    if (!res.ok) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const buf = Buffer.from(await res.arrayBuffer());
    const v = await validateAudioBuffer(buf);
    if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 422 });
  }

  if (!(await consumeDailyBudget(counter))) {
    return NextResponse.json({ error: "budget_exhausted" }, { status: 429 });
  }

  const jobId = await startSeparation(blobUrl);
  return NextResponse.json({ jobId });
}
