import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/separation", () => ({
  getStemSourceUrl: vi.fn(async () => "https://replicate.delivery/x/vocals.mp3"),
}));

import { GET } from "@/app/api/stems/[jobId]/[stem]/route";
import { getStemSourceUrl } from "@/lib/separation";

function makeParams(jobId: string, stem: string) {
  return { params: Promise.resolve({ jobId, stem }) };
}

const REQ = new Request("http://localhost/api/stems/j1/vocals");

beforeEach(() => {
  vi.mocked(getStemSourceUrl).mockClear();
  vi.mocked(getStemSourceUrl).mockResolvedValue("https://replicate.delivery/x/vocals.mp3");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } })),
  );
});

describe("GET /api/stems/[jobId]/[stem]", () => {
  it("streamt eine fertige Spur mit audio/mpeg durch", async () => {
    const res = await GET(REQ, makeParams("job-1", "vocals"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
  });

  it("lehnt unbekannte Spuren mit 404 ab", async () => {
    const res = await GET(REQ, makeParams("job-1", "keyboard"));
    expect(res.status).toBe(404);
  });

  it("lehnt ungültige Job-IDs mit 404 ab (Pfad-Trick-Schutz)", async () => {
    const res = await GET(REQ, makeParams("../../account", "vocals"));
    expect(res.status).toBe(404);
    expect(getStemSourceUrl).not.toHaveBeenCalled();
  });

  it("antwortet 404, wenn der Job nicht fertig ist", async () => {
    vi.mocked(getStemSourceUrl).mockResolvedValue(null);
    const res = await GET(REQ, makeParams("job-1", "vocals"));
    expect(res.status).toBe(404);
  });

  it("antwortet 502, wenn der Upstream nicht ok ist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    const res = await GET(REQ, makeParams("job-1", "vocals"));
    expect(res.status).toBe(502);
  });

  it("antwortet 502, wenn der Upstream-Fetch fehlschlägt (kein 500)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const res = await GET(REQ, makeParams("job-1", "vocals"));
    expect(res.status).toBe(502);
  });
});
