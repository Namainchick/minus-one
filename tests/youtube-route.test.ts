import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/limits", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/limits")>();
  return {
    ...orig,
    defaultCounter: () => new orig.MemoryCounter(),
    checkUploadTokenLimit: vi.fn(async () => true),
  };
});
vi.mock("@/lib/youtube", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/youtube")>();
  return {
    ...orig,
    getYoutubeDurationSeconds: vi.fn(async () => 200),
    downloadYoutubeAudio: vi.fn(async () => "/tmp/fake.mp3"),
  };
});
vi.mock("@/lib/local-demucs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/local-demucs")>();
  return {
    ...orig,
    importDownloadedFile: vi.fn(async () => "upload-yt-1"),
  };
});

import { POST } from "@/app/api/youtube-import/route";
import { downloadYoutubeAudio, getYoutubeDurationSeconds } from "@/lib/youtube";
import { isYoutubeUrl } from "@/lib/youtube";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/youtube-import", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
    body: JSON.stringify(body),
  });
}

const YT_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

beforeEach(() => {
  process.env.LOCAL_DEMUCS = "1";
  vi.mocked(getYoutubeDurationSeconds).mockResolvedValue(200);
  vi.mocked(downloadYoutubeAudio).mockResolvedValue("/tmp/fake.mp3");
});
afterEach(() => {
  delete process.env.LOCAL_DEMUCS;
});

describe("isYoutubeUrl", () => {
  it("akzeptiert youtube.com und youtu.be über https", () => {
    expect(isYoutubeUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isYoutubeUrl("https://youtu.be/abc")).toBe(true);
    expect(isYoutubeUrl("https://music.youtube.com/watch?v=abc")).toBe(true);
  });
  it("lehnt fremde Hosts und http ab", () => {
    expect(isYoutubeUrl("https://evil.com/watch?v=abc")).toBe(false);
    expect(isYoutubeUrl("http://www.youtube.com/watch?v=abc")).toBe(false);
    expect(isYoutubeUrl("nicht mal eine url")).toBe(false);
  });
});

describe("POST /api/youtube-import", () => {
  it("antwortet 404, wenn der lokale Modus aus ist", async () => {
    delete process.env.LOCAL_DEMUCS;
    const res = await POST(makeRequest({ url: YT_URL }));
    expect(res.status).toBe(404);
  });

  it("importiert ein kurzes Video und liefert die Upload-ID", async () => {
    const res = await POST(makeRequest({ url: YT_URL }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uploadId: "upload-yt-1" });
  });

  it("lehnt zu lange Videos mit too_long ab, ohne herunterzuladen", async () => {
    vi.mocked(getYoutubeDurationSeconds).mockResolvedValue(600);
    vi.mocked(downloadYoutubeAudio).mockClear();
    const res = await POST(makeRequest({ url: YT_URL }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "too_long" });
    expect(downloadYoutubeAudio).not.toHaveBeenCalled();
  });

  it("lehnt Nicht-YouTube-URLs ab", async () => {
    const res = await POST(makeRequest({ url: "https://evil.com/x" }));
    expect(res.status).toBe(400);
  });

  it("mappt Download-Fehler auf youtube_failed", async () => {
    vi.mocked(downloadYoutubeAudio).mockRejectedValue(new Error("boom"));
    const res = await POST(makeRequest({ url: YT_URL }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "youtube_failed" });
  });
});
