import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { isValidJobId } from "@/lib/job-id";
import { getJob } from "@/lib/replicate";

export const runtime = "nodejs";

function isOurBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** Original-Upload nach Abschluss löschen (Spec §5: Einmal-Session, nichts bleibt liegen). */
async function deleteInputQuietly(url: string | undefined): Promise<void> {
  if (!url || !isOurBlobUrl(url)) return;
  try {
    await del(url);
  } catch {
    // idempotent: schon gelöscht oder nicht erreichbar -> Cron räumt Reste auf
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidJobId(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const job = await getJob(id);
  if (job.status === "done") {
    await deleteInputQuietly(job.inputUrl);
    return NextResponse.json({ status: "done", stems: job.stems });
  }
  return NextResponse.json(job);
}
