import { parseBuffer } from "music-metadata";
import { MAX_DURATION_SECONDS, MAX_FILE_BYTES } from "./stems";

export type ValidationResult =
  | { ok: true; durationSeconds: number }
  | { ok: false; reason: "too_large" | "bad_format" | "too_long" };

export function sniffAudioFormat(bytes: Uint8Array): "mp3" | "wav" | "m4a" | null {
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45 // "WAVE"
  ) {
    return "wav";
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 // "ftyp"
  ) {
    return "m4a";
  }
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "mp3"; // "ID3"
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "mp3"; // Frame-Sync
  return null;
}

export async function validateAudioBuffer(buf: Buffer): Promise<ValidationResult> {
  if (buf.byteLength > MAX_FILE_BYTES) return { ok: false, reason: "too_large" };
  const format = sniffAudioFormat(new Uint8Array(buf.subarray(0, 16)));
  if (!format) return { ok: false, reason: "bad_format" };

  let duration: number | undefined;
  try {
    const mime = format === "mp3" ? "audio/mpeg" : format === "m4a" ? "audio/mp4" : "audio/wav";
    const meta = await parseBuffer(buf, mime, { duration: true });
    duration = meta.format.duration;
  } catch {
    return { ok: false, reason: "bad_format" };
  }
  if (!duration || !Number.isFinite(duration)) return { ok: false, reason: "bad_format" };
  if (duration > MAX_DURATION_SECONDS) return { ok: false, reason: "too_long" };
  return { ok: true, durationSeconds: duration };
}
