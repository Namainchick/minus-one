import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/limits", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/limits")>();
  return {
    ...orig,
    defaultCounter: () => new orig.MemoryCounter(),
    checkRateLimit: vi.fn(async () => true),
    consumeDailyBudget: vi.fn(async () => true),
  };
});
vi.mock("@/lib/separation", () => ({
  startSeparation: vi.fn(async () => "job-123"),
}));

import { POST } from "@/app/api/separate/route";
import { checkRateLimit, consumeDailyBudget } from "@/lib/limits";
import { startSeparation } from "@/lib/separation";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/separate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
    body: JSON.stringify(body),
  });
}

/** Minimale gültige WAV-Datei als global gemockter fetch-Download. */
function makeWav(seconds: number, sampleRate = 8000): Buffer {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataSize, 40);
  return buf;
}

const BLOB_URL = "https://abc123.public.blob.vercel-storage.com/song.wav";

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(consumeDailyBudget).mockResolvedValue(true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(makeWav(5)))));
});

describe("POST /api/separate", () => {
  it("startet die Trennung bei gültiger Blob-URL", async () => {
    const res = await POST(makeRequest({ blobUrl: BLOB_URL }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: "job-123" });
    expect(startSeparation).toHaveBeenCalledWith(BLOB_URL);
  });

  it("blockt bei Rate-Limit mit 429/rate_limited", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await POST(makeRequest({ blobUrl: BLOB_URL }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });

  it("blockt bei leerem Budget mit 429/budget_exhausted", async () => {
    vi.mocked(consumeDailyBudget).mockResolvedValue(false);
    const res = await POST(makeRequest({ blobUrl: BLOB_URL }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "budget_exhausted" });
  });

  it("lehnt fremde URLs ab (SSRF-Schutz)", async () => {
    const res = await POST(makeRequest({ blobUrl: "https://evil.example.com/x.wav" }));
    expect(res.status).toBe(400);
  });

  it("gibt Validierungsfehler als 422 weiter", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.from("kein audio, nur text ".repeat(10)))));
    const res = await POST(makeRequest({ blobUrl: BLOB_URL }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "bad_format" });
  });

  it("lehnt mock://upload ab, wenn MOCK_REPLICATE nicht gesetzt ist", async () => {
    delete process.env.MOCK_REPLICATE;
    const res = await POST(makeRequest({ blobUrl: "mock://upload" }));
    expect(res.status).toBe(400);
  });

  it("bricht bei zu großem Content-Length ab, ohne den Body zu laden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200, headers: { "content-length": String(16 * 1024 * 1024) } })),
    );
    const res = await POST(makeRequest({ blobUrl: BLOB_URL }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "too_large" });
  });

  it("kappt einen zu großen Body auch ohne Content-Length", async () => {
    const big = new Uint8Array(15 * 1024 * 1024 + 1);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
    const res = await POST(makeRequest({ blobUrl: BLOB_URL }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "too_large" });
  });
});
