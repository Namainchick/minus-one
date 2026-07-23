import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { STEMS, type StemName } from "./stems";
import type { JobStatus } from "./replicate";

const BASE_DIR = path.join(tmpdir(), "minus-one-local");
const UPLOAD_DIR = path.join(BASE_DIR, "uploads");
const OUT_DIR = path.join(BASE_DIR, "out");

export function isLocalDemucsEnabled(): boolean {
  return process.env.LOCAL_DEMUCS === "1";
}

const uploads = new Map<string, string>(); // uploadId -> file path
type LocalJob =
  | { status: "processing" }
  | { status: "failed"; error?: string }
  | { status: "done"; stemDir: string };
const jobs = new Map<string, LocalJob>();

export async function saveLocalUpload(buf: Buffer): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const id = randomUUID();
  const filePath = path.join(UPLOAD_DIR, `${id}.audio`);
  await writeFile(filePath, buf);
  uploads.set(id, filePath);
  return id;
}

export function getLocalUploadPath(uploadId: string): string | null {
  return uploads.get(uploadId) ?? null;
}

function demucsCommand(): string {
  return process.env.DEMUCS_BIN ?? "demucs";
}

/** Startet die lokale Trennung als Kindprozess; gibt die Job-ID zurück. */
export function startLocalSeparation(uploadId: string): string {
  const inputPath = uploads.get(uploadId);
  const jobId = `local-${randomUUID()}`;
  if (!inputPath) {
    jobs.set(jobId, { status: "failed", error: "Upload nicht gefunden" });
    return jobId;
  }
  jobs.set(jobId, { status: "processing" });

  const child = spawn(
    demucsCommand(),
    ["-n", "htdemucs_6s", "--mp3", "--mp3-bitrate", "192", "-o", OUT_DIR, inputPath],
    {
      stdio: "ignore",
      env: { ...process.env, PATH: `${process.env.PATH ?? ""}:${path.join(homedir(), ".local", "bin")}` },
    },
  );

  child.on("error", (err) => {
    jobs.set(jobId, { status: "failed", error: `demucs konnte nicht gestartet werden: ${err.message}` });
  });

  child.on("close", (code) => {
    void (async () => {
      // Upload-Datei nach der Trennung immer aufräumen (Einmal-Session)
      await rm(inputPath, { force: true }).catch(() => undefined);
      uploads.delete(uploadId);
      if (code !== 0) {
        jobs.set(jobId, { status: "failed", error: `demucs beendet mit Code ${code}` });
        return;
      }
      const stemDir = path.join(OUT_DIR, "htdemucs_6s", path.basename(inputPath, ".audio"));
      for (const stem of STEMS) {
        const ok = await stat(path.join(stemDir, `${stem}.mp3`)).catch(() => null);
        if (!ok) {
          jobs.set(jobId, { status: "failed", error: `Spur ${stem} fehlt im Demucs-Output` });
          return;
        }
      }
      jobs.set(jobId, { status: "done", stemDir });
    })();
  });

  return jobId;
}

export function isLocalJobId(id: string): boolean {
  return id.startsWith("local-");
}

export function getLocalJob(jobId: string): JobStatus {
  const job = jobs.get(jobId);
  if (!job) return { status: "failed", error: "unbekannter lokaler Job" };
  if (job.status === "processing") return { status: "processing" };
  if (job.status === "failed") return { status: "failed", error: job.error };
  const stems = Object.fromEntries(STEMS.map((s) => [s, `/api/stems/${jobId}/${s}`])) as Record<StemName, string>;
  return { status: "done", stems };
}

/** Stream einer fertigen lokalen Spur für die Proxy-Route. */
export function getLocalStemStream(jobId: string, stem: StemName): ReadableStream | null {
  const job = jobs.get(jobId);
  if (!job || job.status !== "done") return null;
  const filePath = path.join(job.stemDir, `${stem}.mp3`);
  const nodeStream = createReadStream(filePath);
  // Node-Stream -> Web-Stream für die Response
  return Readable.toWeb(nodeStream) as ReadableStream;
}
