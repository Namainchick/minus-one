import { describe, expect, it } from "vitest";
import { JOB_POLL_INTERVAL_MS, PROCESSING_TIMEOUT_MS } from "@/lib/timing";

describe("processing timing", () => {
  it("allows a ten-minute RunPod job plus polling headroom", () => {
    expect(PROCESSING_TIMEOUT_MS).toBe(12 * 60 * 1000);
  });

  it("polls job status every three seconds", () => {
    expect(JOB_POLL_INTERVAL_MS).toBe(3000);
  });
});
