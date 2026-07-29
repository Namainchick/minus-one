import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/separation", () => ({
  getJob: vi.fn(async () => ({ status: "processing" })),
}));
vi.mock("@vercel/blob", () => ({ del: vi.fn(async () => undefined) }));

import { GET } from "@/app/api/jobs/[id]/route";
import { getJob } from "@/lib/separation";

const REQ = new Request("http://localhost/api/jobs/j1");

describe("GET /api/jobs/[id]", () => {
  it("gibt den Status durch", async () => {
    const res = await GET(REQ, { params: Promise.resolve({ id: "job-1" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "processing" });
  });

  it("lehnt ungültige Job-IDs mit 404 ab, ohne Replicate zu fragen", async () => {
    vi.mocked(getJob).mockClear();
    const res = await GET(REQ, { params: Promise.resolve({ id: "../../account" }) });
    expect(res.status).toBe(404);
    expect(getJob).not.toHaveBeenCalled();
  });

  it("strippt inputUrl aus der done-Antwort", async () => {
    vi.mocked(getJob).mockResolvedValue({
      status: "done",
      stems: { vocals: "/api/stems/j/vocals" } as never,
      inputUrl: "https://x.public.blob.vercel-storage.com/song.wav",
    });
    const res = await GET(REQ, { params: Promise.resolve({ id: "job-1" }) });
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.inputUrl).toBeUndefined();
  });
});
