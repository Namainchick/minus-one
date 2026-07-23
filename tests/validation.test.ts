import { describe, expect, it } from "vitest";
import { sniffAudioFormat, validateAudioBuffer } from "@/lib/validation";
import { MAX_FILE_BYTES } from "@/lib/stems";

/** Erzeugt eine echte, minimale WAV-Datei (PCM 16-bit mono). */
function makeWav(seconds: number, sampleRate = 8000): Buffer {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

describe("sniffAudioFormat", () => {
  it("erkennt WAV am RIFF/WAVE-Header", () => {
    expect(sniffAudioFormat(new Uint8Array(makeWav(1)))).toBe("wav");
  });
  it("erkennt MP3 am ID3-Tag", () => {
    expect(sniffAudioFormat(new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("mp3");
  });
  it("erkennt MP3 am Frame-Sync", () => {
    expect(sniffAudioFormat(new Uint8Array([0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("mp3");
  });
  it("lehnt anderes ab", () => {
    expect(sniffAudioFormat(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe("validateAudioBuffer", () => {
  it("akzeptiert kurze WAV und liefert Dauer", async () => {
    const r = await validateAudioBuffer(makeWav(5));
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.durationSeconds).toBeGreaterThan(4);
  });
  it("lehnt zu große Dateien ab", async () => {
    const r = await validateAudioBuffer(Buffer.alloc(MAX_FILE_BYTES + 1));
    expect(r).toEqual({ ok: false, reason: "too_large" });
  });
  it("lehnt Nicht-Audio ab", async () => {
    const r = await validateAudioBuffer(Buffer.from("kein audio, nur text ".repeat(10)));
    expect(r).toEqual({ ok: false, reason: "bad_format" });
  });
  it("lehnt zu lange Songs ab", async () => {
    const r = await validateAudioBuffer(makeWav(7 * 60 + 30));
    expect(r).toEqual({ ok: false, reason: "too_long" });
  });
});
