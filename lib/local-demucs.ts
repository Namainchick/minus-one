import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { STEMS, type StemName } from "./stems";
import type { JobStatus } from "./replicate";

const BASE_DIR = path.join(tmpdir(), "minus-one-local");
const UPLOAD_DIR = path.join(BASE_DIR, "uploads");
const OUT_DIR = path.join(BASE_DIR, "out");
const UPLOAD_MAX_AGE_MS = 60 * 60 * 1000; // 1h
const OUTPUT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/** Löscht verwaiste Uploads (>1h) und alte Stem-Ordner (>24h). Best effort. */
async function sweepOldFiles(): Promise<void> {
  const now = Date.now();
  for (const [dir, maxAge] of [
    [UPLOAD_DIR, UPLOAD_MAX_AGE_MS],
    [OUT_DIR, OUTPUT_MAX_AGE_MS],
  ] as const) {
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const entry of entries) {
      const p = path.join(dir, entry);
      const s = await stat(p).catch(() => null);
      if (s && now - s.mtimeMs > maxAge) {
        await rm(p, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}

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
  void sweepOldFiles();
  await mkdir(UPLOAD_DIR, { recursive: true });
  const id = randomUUID();
  const filePath = path.join(UPLOAD_DIR, `${id}.audio`);
  await writeFile(filePath, buf);
  uploads.set(id, filePath);
  return id;
}

/** Registriert eine bereits heruntergeladene Datei als Upload (verschiebt sie ins Upload-Verzeichnis). */
export async function importDownloadedFile(srcPath: string): Promise<string> {
  void sweepOldFiles();
  await mkdir(UPLOAD_DIR, { recursive: true });
  const id = randomUUID();
  const destPath = path.join(UPLOAD_DIR, `${id}.audio`);
  await rename(srcPath, destPath).catch(async () => {
    await copyFile(srcPath, destPath);
    await rm(srcPath, { force: true });
  });
  uploads.set(id, destPath);
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
  uploads.delete(uploadId);
  const jobId = `local-${randomUUID()}`;
  if (!inputPath) {
    jobs.set(jobId, { status: "failed", error: "Upload not found" });
    return jobId;
  }
  jobs.set(jobId, { status: "processing" });
  const jobOutDir = path.join(OUT_DIR, jobId);

  const child = spawn(
    demucsCommand(),
    ["-n", "htdemucs_6s", "--mp3", "--mp3-bitrate", "192", "-o", jobOutDir, inputPath],
    {
      stdio: "ignore",
      env: { ...process.env, PATH: `${process.env.PATH ?? ""}:${path.join(homedir(), ".local", "bin")}` },
    },
  );

  child.on("error", (err) => {
    jobs.set(jobId, { status: "failed", error: `demucs could not be started: ${err.message}` });
  });

  child.on("close", (code) => {
    void (async () => {
      // Upload-Datei nach der Trennung immer aufräumen (Einmal-Session)
      await rm(inputPath, { force: true }).catch(() => undefined);
      if (code !== 0) {
        jobs.set(jobId, { status: "failed", error: `demucs exited with code ${code}` });
        return;
      }
      const stemDir = path.join(jobOutDir, "htdemucs_6s", path.basename(inputPath, ".audio"));
      for (const stem of STEMS) {
        const ok = await stat(path.join(stemDir, `${stem}.mp3`)).catch(() => null);
        if (!ok) {
          jobs.set(jobId, { status: "failed", error: `Stem ${stem} is missing from the Demucs output` });
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
