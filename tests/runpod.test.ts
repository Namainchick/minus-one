import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { STEMS } from "@/lib/stems";

vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: vi.fn(async ({ pathname }: { pathname: string }) => `token:${pathname}`),
}));
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
}));

const ENDPOINT_ID = "endpoint-123";
const API_KEY = "runpod-secret";
const JOB_ID = "job-123";
const INPUT_URL = "https://source.public.blob.vercel-storage.com/song.m4a";
const outputUrls = Object.fromEntries(
  STEMS.map((stem) => [stem, `https://results.public.blob.vercel-storage.com/runpod/out/${stem}.mp3`]),
);

function rawJob(status: string, extra: Record<string, unknown> = {}) {
  return { id: JOB_ID, status, ...extra };
}

beforeEach(() => {
  process.env.RUNPOD_API_KEY = API_KEY;
  process.env.RUNPOD_ENDPOINT_ID = ENDPOINT_ID;
  vi.mocked(generateClientTokenFromReadWriteToken).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.RUNPOD_API_KEY;
  delete process.env.RUNPOD_ENDPOINT_ID;
});

describe("startRunpodSeparation", () => {
  it("generates six scoped tokens and submits one async RunPod job", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: JOB_ID, status: "IN_QUEUE" }));
    vi.stubGlobal("fetch", fetchMock);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const { startRunpodSeparation } = await import("@/lib/runpod");

    await expect(startRunpodSeparation(INPUT_URL)).resolves.toBe(JOB_ID);

    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledTimes(6);
    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledWith({
      pathname: "runpod/00000000-0000-4000-8000-000000000001/vocals.mp3",
      allowedContentTypes: ["audio/mpeg"],
      maximumSizeInBytes: 20 * 1024 * 1024,
      addRandomSuffix: false,
      allowOverwrite: true,
      validUntil: expect.any(Number),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.runpod.ai/v2/${ENDPOINT_ID}/run`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    const body = JSON.parse(String(init?.body));
    expect(body.policy).toEqual({ executionTimeout: 600_000, ttl: 3_600_000 });
    expect(body.input.audioUrl).toBe(INPUT_URL);
    expect(Object.keys(body.input.uploads)).toEqual([...STEMS]);
    expect(body.input.uploads.other.pathname).toMatch(/^runpod\/.+\/other\.mp3$/);
  });

  it("requires RunPod env vars and never retries a failed start", async () => {
    delete process.env.RUNPOD_API_KEY;
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { startRunpodSeparation } = await import("@/lib/runpod");

    await expect(startRunpodSeparation(INPUT_URL)).rejects.toThrow(/RUNPOD_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();

    process.env.RUNPOD_API_KEY = API_KEY;
    await expect(startRunpodSeparation(INPUT_URL)).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("mapRunpodJob", () => {
  it("maps queue and processing states", async () => {
    const { mapRunpodJob } = await import("@/lib/runpod");
    expect(mapRunpodJob(rawJob("IN_QUEUE"))).toEqual({ status: "queued" });
    expect(mapRunpodJob(rawJob("IN_PROGRESS"))).toEqual({ status: "processing" });
    expect(mapRunpodJob(rawJob("RUNNING"))).toEqual({ status: "processing" });
  });

  it("maps a complete six-stem output to same-origin proxy URLs", async () => {
    const { mapRunpodJob } = await import("@/lib/runpod");
    const result = mapRunpodJob(rawJob("COMPLETED", { output: { inputUrl: INPUT_URL, stems: outputUrls } }));

    expect(result).toEqual({
      status: "done",
      inputUrl: INPUT_URL,
      stems: Object.fromEntries(STEMS.map((stem) => [stem, `/api/stems/${JOB_ID}/${stem}`])),
    });
  });

  it.each(["FAILED", "CANCELLED", "TIMED_OUT"])("maps %s to failed", async (status) => {
    const { mapRunpodJob } = await import("@/lib/runpod");
    expect(mapRunpodJob(rawJob(status, { error: "boom" }))).toEqual({ status: "failed", error: "boom" });
  });

  it("fails closed for missing stems, foreign URLs, malformed output, and unknown states", async () => {
    const { mapRunpodJob } = await import("@/lib/runpod");
    const missing = { ...outputUrls };
    delete missing.piano;
    expect(mapRunpodJob(rawJob("COMPLETED", { output: { inputUrl: INPUT_URL, stems: missing } })).status).toBe(
      "failed",
    );
    expect(
      mapRunpodJob(
        rawJob("COMPLETED", {
          output: { inputUrl: INPUT_URL, stems: { ...outputUrls, vocals: "https://evil.example/vocals.mp3" } },
        }),
      ).status,
    ).toBe("failed");
    expect(mapRunpodJob(rawJob("COMPLETED", { output: null })).status).toBe("failed");
    expect(mapRunpodJob(rawJob("MYSTERY")).status).toBe("failed");
  });
});

describe("RunPod status retrieval", () => {
  it("retries idempotent status requests twice for retryable responses", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 500 }))
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(Response.json(rawJob("IN_QUEUE")));
    vi.stubGlobal("fetch", fetchMock);
    const { getRunpodJob } = await import("@/lib/runpod");

    const resultPromise = getRunpodJob(JOB_ID);
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toEqual({ status: "queued" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails after two retries and rejects mismatched response job IDs", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 500 }))
      .mockResolvedValueOnce(new Response("busy", { status: 500 }))
      .mockResolvedValueOnce(new Response("busy", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getRunpodJob } = await import("@/lib/runpod");

    const exhaustedExpectation = expect(getRunpodJob(JOB_ID)).rejects.toThrow(/500/);
    await vi.runAllTimersAsync();
    await exhaustedExpectation;
    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
    fetchMock.mockReset().mockResolvedValue(Response.json({ id: "different-job", status: "IN_QUEUE" }));
    await expect(getRunpodJob(JOB_ID)).rejects.toThrow(/abweichende Job-ID/);
  });

  it("rejects invalid job IDs without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getRunpodJob } = await import("@/lib/runpod");

    await expect(getRunpodJob("../../secret")).rejects.toThrow(/Job-ID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns only a validated completed stem source URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(rawJob("COMPLETED", { output: { inputUrl: INPUT_URL, stems: outputUrls } })))
      .mockResolvedValueOnce(Response.json(rawJob("RUNNING")))
      .mockResolvedValueOnce(
        Response.json(
          rawJob("COMPLETED", {
            output: { inputUrl: INPUT_URL, stems: { ...outputUrls, vocals: "https://evil.example/vocals.mp3" } },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getRunpodStemSourceUrl } = await import("@/lib/runpod");

    await expect(getRunpodStemSourceUrl(JOB_ID, "vocals")).resolves.toBe(outputUrls.vocals);
    await expect(getRunpodStemSourceUrl(JOB_ID, "vocals")).resolves.toBeNull();
    await expect(getRunpodStemSourceUrl(JOB_ID, "vocals")).resolves.toBeNull();
  });
});
