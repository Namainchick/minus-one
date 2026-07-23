import { NextResponse } from "next/server";
import { checkUploadTokenLimit, defaultCounter } from "@/lib/limits";
import { isLocalDemucsEnabled, saveLocalUpload } from "@/lib/local-demucs";
import { readBodyCapped } from "@/lib/read-body";
import { ipFromRequest } from "@/lib/request";
import { MAX_FILE_BYTES } from "@/lib/stems";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isLocalDemucsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const ip = ipFromRequest(request);
  if (!(await checkUploadTokenLimit(defaultCounter(), ip))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const buf = await readBodyCapped(request as unknown as Response, MAX_FILE_BYTES);
  if (!buf) return NextResponse.json({ error: "too_large" }, { status: 422 });
  if (buf.byteLength === 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const uploadId = await saveLocalUpload(buf);
  return NextResponse.json({ uploadId });
}
