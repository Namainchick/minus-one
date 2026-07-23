/** Liest den Body nur bis maxBytes; null = zu groß. Schutz vor Speicher-DoS. */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
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
