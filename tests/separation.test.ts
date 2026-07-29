import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/replicate", () => ({
  startSeparation: vi.fn(async () => "replicate-job"),
  getJob: vi.fn(async () => ({ status: "queued" })),
  getStemSourceUrl: vi.fn(async () => "https://replicate.delivery/stem.mp3"),
}));
vi.mock("@/lib/runpod", () => ({
  startRunpodSeparation: vi.fn(async () => "runpod-job"),
  getRunpodJob: vi.fn(async () => ({ status: "processing" })),
  getRunpodStemSourceUrl: vi.fn(async () => "https://store.public.blob.vercel-storage.com/stem.mp3"),
}));
vi.mock("@/lib/local-demucs", () => ({
  isLocalJobId: vi.fn((id: string) => id.startsWith("local-")),
  getLocalJob: vi.fn(() => ({ status: "done", stems: {} })),
}));

import { getLocalJob } from "@/lib/local-demucs";
import * as replicate from "@/lib/replicate";
import * as runpod from "@/lib/runpod";
import { getJob, getStemSourceUrl, startSeparation } from "@/lib/separation";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SEPARATION_PROVIDER;
});

afterEach(() => {
  delete process.env.SEPARATION_PROVIDER;
});

describe("separation provider facade", () => {
  it("uses Replicate by default and when explicitly selected", async () => {
    await expect(startSeparation("https://blob/input.mp3")).resolves.toBe("replicate-job");
    expect(replicate.startSeparation).toHaveBeenCalledOnce();

    process.env.SEPARATION_PROVIDER = "replicate";
    await getJob("job-1");
    await getStemSourceUrl("job-1", "vocals");
    expect(replicate.getJob).toHaveBeenCalledWith("job-1");
    expect(replicate.getStemSourceUrl).toHaveBeenCalledWith("job-1", "vocals");
  });

  it("uses RunPod when selected", async () => {
    process.env.SEPARATION_PROVIDER = "runpod";

    await expect(startSeparation("https://blob/input.mp3")).resolves.toBe("runpod-job");
    await expect(getJob("job-1")).resolves.toEqual({ status: "processing" });
    await expect(getStemSourceUrl("job-1", "drums")).resolves.toContain("vercel-storage.com");
    expect(runpod.startRunpodSeparation).toHaveBeenCalledOnce();
    expect(runpod.getRunpodJob).toHaveBeenCalledWith("job-1");
    expect(runpod.getRunpodStemSourceUrl).toHaveBeenCalledWith("job-1", "drums");
    expect(replicate.startSeparation).not.toHaveBeenCalled();
  });

  it("routes local job status before the selected remote provider", async () => {
    process.env.SEPARATION_PROVIDER = "runpod";

    await expect(getJob("local-123")).resolves.toEqual({ status: "done", stems: {} });
    expect(getLocalJob).toHaveBeenCalledWith("local-123");
    expect(runpod.getRunpodJob).not.toHaveBeenCalled();
  });

  it("rejects unknown providers clearly", async () => {
    process.env.SEPARATION_PROVIDER = "unknown";

    await expect(startSeparation("https://blob/input.mp3")).rejects.toThrow(/SEPARATION_PROVIDER/);
  });
});
