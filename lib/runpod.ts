import { randomUUID } from "node:crypto";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { isValidJobId } from "./job-id";
import type { JobStatus } from "./replicate";
import { STEMS, type StemName } from "./stems";

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";
const REQUEST_TIMEOUT_MS = 10_000;
const EXECUTION_TIMEOUT_MS = 600_000;
const JOB_TTL_MS = 3_600_000;
const TOKEN_VALIDITY_MS = 3_600_000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const STATUS_RETRY_DELAYS_MS = [250, 500] as const;

type UnknownRecord = Record<string, unknown>;

export interface RawRunpodJob {
  id: string;
  status: string;
  output?: unknown;
  error?: unknown;
  delayTime?: number;
  executionTime?: number;
}

interface CompletedOutput {
  inputUrl: string;
  stems: Record<StemName, string>;
}

function requireEnv(name: "RUNPOD_API_KEY" | "RUNPOD_ENDPOINT_ID"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} fehlt — RunPod kann nicht verwendet werden (siehe .env.example).`);
  return value;
}

function endpointBase(): string {
  const endpointId = requireEnv("RUNPOD_ENDPOINT_ID");
  if (!/^[A-Za-z0-9_-]+$/.test(endpointId)) throw new Error("RUNPOD_ENDPOINT_ID ist ungültig");
  return `${RUNPOD_API_BASE}/${endpointId}`;
}

function authorizationHeaders(): HeadersInit {
  return {
    authorization: `Bearer ${requireEnv("RUNPOD_API_KEY")}`,
    "content-type": "application/json",
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVercelBlobUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function errorText(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (error === undefined || error === null) return undefined;
  try {
    return JSON.stringify(error);
  } catch {
    return "RunPod-Job fehlgeschlagen";
  }
}

function validateCompletedOutput(output: unknown): CompletedOutput | null {
  if (!isRecord(output) || !isVercelBlobUrl(output.inputUrl) || !isRecord(output.stems)) return null;
  const stems = {} as Record<StemName, string>;
  for (const stem of STEMS) {
    const url = output.stems[stem];
    if (!isVercelBlobUrl(url)) return null;
    stems[stem] = url;
  }
  return { inputUrl: output.inputUrl, stems };
}

async function readJson(response: Response, operation: string): Promise<UnknownRecord> {
  if (!response.ok) throw new Error(`RunPod ${operation} fehlgeschlagen (HTTP ${response.status})`);
  const body = (await response.json().catch(() => null)) as unknown;
  if (!isRecord(body)) throw new Error(`RunPod ${operation} lieferte keine gültige JSON-Antwort`);
  return body;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function mapRunpodJob(job: RawRunpodJob): JobStatus {
  if (!isValidJobId(job.id)) return { status: "failed", error: "RunPod lieferte eine ungültige Job-ID" };
  switch (job.status) {
    case "IN_QUEUE":
      return { status: "queued" };
    case "IN_PROGRESS":
    case "RUNNING":
      return { status: "processing" };
    case "COMPLETED": {
      const output = validateCompletedOutput(job.output);
      if (!output) return { status: "failed", error: "RunPod-Ergebnis enthält nicht alle gültigen Spuren" };
      return {
        status: "done",
        inputUrl: output.inputUrl,
        stems: Object.fromEntries(STEMS.map((stem) => [stem, `/api/stems/${job.id}/${stem}`])) as Record<
          StemName,
          string
        >,
      };
    }
    case "FAILED":
    case "CANCELLED":
    case "TIMED_OUT":
      return { status: "failed", error: errorText(job.error) };
    default:
      return { status: "failed", error: `Unbekannter RunPod-Status: ${job.status}` };
  }
}

export async function startRunpodSeparation(audioUrl: string): Promise<string> {
  if (!isVercelBlobUrl(audioUrl)) throw new Error("RunPod-Eingabe muss eine öffentliche Vercel-Blob-URL sein");
  const baseUrl = endpointBase();
  const headers = authorizationHeaders();
  const outputId = randomUUID();
  const validUntil = Date.now() + TOKEN_VALIDITY_MS;
  const uploads = Object.fromEntries(
    await Promise.all(
      STEMS.map(async (stem) => {
        const pathname = `runpod/${outputId}/${stem}.mp3`;
        const token = await generateClientTokenFromReadWriteToken({
          pathname,
          allowedContentTypes: ["audio/mpeg"],
          maximumSizeInBytes: MAX_OUTPUT_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
          validUntil,
        });
        return [stem, { pathname, token }] as const;
      }),
    ),
  );

  const response = await fetch(`${baseUrl}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { audioUrl, uploads },
      policy: { executionTimeout: EXECUTION_TIMEOUT_MS, ttl: JOB_TTL_MS },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await readJson(response, "Job-Start");
  const id = body.id;
  if (typeof id !== "string" || !isValidJobId(id)) throw new Error("RunPod lieferte eine ungültige Job-ID");
  return id;
}

export async function getRunpodRaw(id: string): Promise<RawRunpodJob> {
  if (!isValidJobId(id)) throw new Error("RunPod Job-ID ist ungültig");
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${endpointBase()}/status/${id}`, {
      headers: authorizationHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < STATUS_RETRY_DELAYS_MS.length) {
      await response.body?.cancel().catch(() => undefined);
      await sleep(STATUS_RETRY_DELAYS_MS[attempt]);
      continue;
    }
    const body = await readJson(response, "Statusabfrage");
    if (typeof body.id !== "string" || typeof body.status !== "string") {
      throw new Error("RunPod Statusabfrage lieferte ungültige Felder");
    }
    if (body.id !== id) throw new Error("RunPod Statusabfrage lieferte eine abweichende Job-ID");
    return body as unknown as RawRunpodJob;
  }
}

export async function getRunpodJob(id: string): Promise<JobStatus> {
  return mapRunpodJob(await getRunpodRaw(id));
}

export async function getRunpodStemSourceUrl(id: string, stem: StemName): Promise<string | null> {
  const job = await getRunpodRaw(id);
  if (job.status !== "COMPLETED") return null;
  return validateCompletedOutput(job.output)?.stems[stem] ?? null;
}
