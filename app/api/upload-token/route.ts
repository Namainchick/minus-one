import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { checkUploadTokenLimit, defaultCounter } from "@/lib/limits";
import { ipFromRequest } from "@/lib/request";
import { MAX_FILE_BYTES } from "@/lib/stems";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const ip = ipFromRequest(request);
  if (!(await checkUploadTokenLimit(defaultCounter(), ip))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave"],
        maximumSizeInBytes: MAX_FILE_BYTES,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // bewusst leer: Aufräumen übernehmen jobs-Route + Cron
      },
    });
    return NextResponse.json(json);
  } catch {
    return NextResponse.json({ error: "upload_failed" }, { status: 400 });
  }
}
