import { getStemSourceUrl } from "@/lib/replicate";
import { STEMS, type StemName } from "@/lib/stems";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string; stem: string }> },
): Promise<Response> {
  const { jobId, stem } = await params;
  if (!(STEMS as readonly string[]).includes(stem)) {
    return new Response("unbekannte Spur", { status: 404 });
  }
  const src = await getStemSourceUrl(jobId, stem as StemName);
  if (!src) return new Response("noch nicht fertig", { status: 404 });

  const upstream = await fetch(src);
  if (!upstream.ok || !upstream.body) return new Response("Quelle nicht erreichbar", { status: 502 });

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
