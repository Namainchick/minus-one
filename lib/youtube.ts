import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const YOUTUBE_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be",
]);

export function isYoutubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && YOUTUBE_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function ytDlpCommand(): string {
  return process.env.YT_DLP_BIN ?? "yt-dlp";
}

function runYtDlp(args: string[], timeoutMs: number): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpCommand(), args, {
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin` },
    });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout });
    });
  });
}

/** Dauer in Sekunden, ohne Download. */
export async function getYoutubeDurationSeconds(url: string): Promise<number> {
  const { code, stdout } = await runYtDlp(["--no-playlist", "--print", "duration", "--skip-download", url], 30_000);
  if (code !== 0) throw new Error("yt-dlp duration check failed");
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error("yt-dlp returned no duration");
  return seconds;
}

/** Lädt die Tonspur als MP3 herunter; der Aufrufer muss anschließend cleanup ausführen. */
export async function downloadYoutubeAudio(url: string): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "minus-one-yt-"));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  const base = path.join(dir, randomUUID());
  const filePath = `${base}.mp3`;
  try {
    const { code } = await runYtDlp(
      ["--no-playlist", "-f", "bestaudio", "-x", "--audio-format", "mp3", "--audio-quality", "192K", "--max-filesize", "30M", "-o", `${base}.%(ext)s`, url],
      180_000,
    );
    if (code !== 0) throw new Error("yt-dlp download failed");
    await stat(filePath);
    return { filePath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
