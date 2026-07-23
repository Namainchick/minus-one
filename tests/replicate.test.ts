import { afterEach, describe, expect, it } from "vitest";
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

describe("startSeparation ohne Env-Vars", () => {
  const originalToken = process.env.REPLICATE_API_TOKEN;
  const originalMock = process.env.MOCK_REPLICATE;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.REPLICATE_API_TOKEN;
    else process.env.REPLICATE_API_TOKEN = originalToken;
    if (originalMock === undefined) delete process.env.MOCK_REPLICATE;
    else process.env.MOCK_REPLICATE = originalMock;
  });

  it("wirft eine klare Fehlermeldung im Real-Modus ohne Token", async () => {
    delete process.env.MOCK_REPLICATE;
    delete process.env.REPLICATE_API_TOKEN;
    const { startSeparation } = await import("@/lib/replicate");
    await expect(startSeparation("https://x.public.blob.vercel-storage.com/a.wav")).rejects.toThrow(
      /REPLICATE_API_TOKEN/,
    );
  });
});
