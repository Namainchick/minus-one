import { upload } from "@vercel/blob/client";
import { MAX_FILE_BYTES } from "./stems";

export type ClientCheck = { ok: true } | { ok: false; reason: "too_large" | "bad_format" };

/** Schnelle Client-Vorprüfung (nur Komfort — der Server prüft nochmal richtig). */
export function precheckFile(file: File): ClientCheck {
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: "too_large" };
  const name = file.name.toLowerCase();
  if (!name.endsWith(".mp3") && !name.endsWith(".wav")) return { ok: false, reason: "bad_format" };
  return { ok: true };
}

/** Lädt die Datei zu Vercel Blob hoch und gibt die URL zurück (Mock-Modus für E2E/Dev). */
export async function uploadSong(file: File): Promise<string> {
  if (process.env.NEXT_PUBLIC_LOCAL_UPLOAD === "1") {
    const res = await fetch("/api/local-upload", { method: "POST", body: file });
    if (!res.ok) throw new Error("local upload failed");
    const { uploadId } = (await res.json()) as { uploadId: string };
    return `local://${uploadId}`;
  }
  if (process.env.NEXT_PUBLIC_MOCK_UPLOAD === "1") return "mock://upload";
  const blob = await upload(file.name, file, {
    access: "public",
    handleUploadUrl: "/api/upload-token",
  });
  return blob.url;
}
