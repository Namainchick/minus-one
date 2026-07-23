import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const cutoff = Date.now() - MAX_AGE_MS;
  const { blobs } = await list();
  const stale = blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff);
  await Promise.all(stale.map((b) => del(b.url)));
  return NextResponse.json({ deleted: stale.length });
}
