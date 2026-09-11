import { isValidJobId } from "@/lib/job-id";
import { getLocalStemStream, isLocalJobId } from "@/lib/local-demucs";
import { getStemSourceUrl } from "@/lib/separation";
import { STEMS, type StemName } from "@/lib/stems";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string; stem: string }> },
): Promise<Response> {
  const { jobId, stem } = await params;
  if (!isValidJobId(jobId) || !(STEMS as readonly string[]).includes(stem)) {
    return new Response("unknown stem", { status: 404 });
  }
  if (isLocalJobId(jobId)) {
    const stream = getLocalStemStream(jobId, stem as StemName);
    if (!stream) return new Response("not ready yet", { status: 404 });
    return new Response(stream, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" },
    });
  }
  const src = await getStemSourceUrl(jobId, stem as StemName);
  if (!src) return new Response("not ready yet", { status: 404 });

  const upstream = await fetch(src, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response("source unreachable", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
