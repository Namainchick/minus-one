import { describe, expect, it } from "vitest";
import { mapPrediction } from "@/lib/replicate";

const output = {
  vocals: "https://replicate.delivery/x/vocals.mp3",
  drums: "https://replicate.delivery/x/drums.mp3",
  bass: "https://replicate.delivery/x/bass.mp3",
  guitar: "https://replicate.delivery/x/guitar.mp3",
  piano: "https://replicate.delivery/x/piano.mp3",
  other: "https://replicate.delivery/x/other.mp3",
};

describe("mapPrediction", () => {
  it("mappt starting auf queued", () => {
    expect(mapPrediction({ id: "j1", status: "starting" })).toEqual({ status: "queued" });
  });
  it("mappt processing auf processing", () => {
    expect(mapPrediction({ id: "j1", status: "processing" })).toEqual({ status: "processing" });
  });
  it("mappt succeeded auf done mit Proxy-URLs", () => {
    const r = mapPrediction({ id: "j1", status: "succeeded", output, input: { audio: "https://blob/x" } });
    expect(r.status).toBe("done");
    if (r.status === "done") {
      expect(r.stems.vocals).toBe("/api/stems/j1/vocals");
      expect(r.stems.other).toBe("/api/stems/j1/other");
      expect(r.inputUrl).toBe("https://blob/x");
    }
  });
  it("meldet failed, wenn eine Spur im Output fehlt", () => {
    const broken = { ...output } as Record<string, string>;
    delete broken.piano;
    const r = mapPrediction({ id: "j1", status: "succeeded", output: broken });
    expect(r.status).toBe("failed");
  });
  it("mappt failed/canceled auf failed", () => {
    expect(mapPrediction({ id: "j1", status: "failed", error: "boom" }).status).toBe("failed");
    expect(mapPrediction({ id: "j1", status: "canceled" }).status).toBe("failed");
  });
});
