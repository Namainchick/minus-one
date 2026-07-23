import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/limits", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/limits")>();
  return {
    ...orig,
    defaultCounter: () => new orig.MemoryCounter(),
    checkRateLimit: vi.fn(async () => true),
    checkUploadTokenLimit: vi.fn(async () => true),
    consumeDailyBudget: vi.fn(async () => true),
  };
});
vi.mock("@/lib/local-demucs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/local-demucs")>();
  return {
    ...orig,
    getLocalUploadPath: vi.fn(() => null as string | null),
    startLocalSeparation: vi.fn(() => "local-test-job"),
    saveLocalUpload: vi.fn(async () => "upload-1"),
  };
});

import { POST as separatePost } from "@/app/api/separate/route";
import { POST as localUploadPost } from "@/app/api/local-upload/route";
import { getLocalUploadPath } from "@/lib/local-demucs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

function separateRequest(blobUrl: string): Request {
  return new Request("http://localhost/api/separate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
    body: JSON.stringify({ blobUrl }),
  });
}

beforeEach(() => {
  process.env.LOCAL_DEMUCS = "1";
});
afterEach(() => {
  delete process.env.LOCAL_DEMUCS;
});

describe("local mode", () => {
  it("lehnt local:// ab, wenn der Modus aus ist", async () => {
    delete process.env.LOCAL_DEMUCS;
    const res = await separatePost(separateRequest("local://abc"));
    expect(res.status).toBe(400);
  });

  it("startet die lokale Trennung für einen gültigen Upload", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "minus-one-test-"));
    const wavPath = path.join(dir, "u.audio");
    await writeFile(wavPath, makeWav(3));
    vi.mocked(getLocalUploadPath).mockReturnValue(wavPath);
    const res = await separatePost(separateRequest("local://upload-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: "local-test-job" });
  });

  it("weist unbekannte Upload-IDs ab", async () => {
    vi.mocked(getLocalUploadPath).mockReturnValue(null);
    const res = await separatePost(separateRequest("local://missing"));
    expect(res.status).toBe(400);
  });

  it("local-upload antwortet 404, wenn der Modus aus ist", async () => {
    delete process.env.LOCAL_DEMUCS;
    const res = await localUploadPost(new Request("http://localhost/api/local-upload", { method: "POST", body: new Uint8Array(makeWav(1)) }));
    expect(res.status).toBe(404);
  });

  it("local-upload speichert und gibt eine Upload-ID zurück", async () => {
    const res = await localUploadPost(new Request("http://localhost/api/local-upload", { method: "POST", body: new Uint8Array(makeWav(1)), headers: { "x-forwarded-for": "9.9.9.9" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uploadId: "upload-1" });
  });
});
