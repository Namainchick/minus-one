import { NextResponse } from "next/server";
import { checkUploadTokenLimit, defaultCounter } from "@/lib/limits";
import { importDownloadedFile, isLocalDemucsEnabled } from "@/lib/local-demucs";
import { ipFromRequest } from "@/lib/request";
import { MAX_DURATION_SECONDS } from "@/lib/stems";
import { downloadYoutubeAudio, getYoutubeDurationSeconds, isYoutubeUrl } from "@/lib/youtube";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isLocalDemucsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const ip = ipFromRequest(request);
  if (!(await checkUploadTokenLimit(defaultCounter(), ip))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = body?.url;
  if (typeof url !== "string" || !isYoutubeUrl(url)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  try {
    const duration = await getYoutubeDurationSeconds(url);
    if (duration > MAX_DURATION_SECONDS) {
      return NextResponse.json({ error: "too_long" }, { status: 422 });
    }
    const filePath = await downloadYoutubeAudio(url);
    const uploadId = await importDownloadedFile(filePath);
    return NextResponse.json({ uploadId });
  } catch {
    return NextResponse.json({ error: "youtube_failed" }, { status: 502 });
  }
}
