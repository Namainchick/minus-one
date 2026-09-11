import Replicate from "replicate";
import { getLocalJob, isLocalJobId } from "./local-demucs";
import { STEMS, type StemName } from "./stems";

export type JobStatus =
  | { status: "queued" | "processing" }
  | { status: "failed"; error?: string }
  | { status: "done"; stems: Record<StemName, string>; inputUrl?: string };

export interface RawPrediction {
  id: string;
  status: string;
  output?: unknown;
  error?: unknown;
  input?: { audio?: string };
}

/** Reines Mapping Replicate-Prediction -> App-Job. Stems zeigen auf unsere Proxy-Route. */
export function mapPrediction(p: RawPrediction): JobStatus {
  switch (p.status) {
    case "starting":
      return { status: "queued" };
    case "processing":
      return { status: "processing" };
    case "succeeded": {
      const out = (p.output ?? {}) as Record<string, string>;
      const stems = {} as Record<StemName, string>;
      for (const s of STEMS) {
        if (!out[s]) return { status: "failed", error: `Stem "${s}" is missing from the result` };
        stems[s] = `/api/stems/${p.id}/${s}`;
      }
      return { status: "done", stems, inputUrl: p.input?.audio };
    }
    default:
      return { status: "failed", error: p.error ? String(p.error) : undefined };
  }
}

// ---------- Mock (MOCK_REPLICATE=1, für Dev und E2E) ----------

const MOCK_PROCESSING_MS = 4000;
const mockJobs = new Map<string, { startedAt: number; audioUrl: string }>();

function mockBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
}

function mockPrediction(id: string): RawPrediction {
  const job = mockJobs.get(id);
  if (!job) return { id, status: "failed", error: "unbekannter Mock-Job" };
  if (Date.now() - job.startedAt < MOCK_PROCESSING_MS) return { id, status: "processing" };
  const output = Object.fromEntries(STEMS.map((s) => [s, `${mockBaseUrl()}/demo/${s}.mp3`]));
  return { id, status: "succeeded", output, input: { audio: job.audioUrl } };
}

// ---------- Echte Replicate-Anbindung ----------

function isMock(): boolean {
  return process.env.MOCK_REPLICATE === "1";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing — real stem separation cannot run without this env var (see .env.example).`);
  }
  return value;
}

function client(): Replicate {
  return new Replicate({ auth: requireEnv("REPLICATE_API_TOKEN") });
}

/** Startet die Trennung, gibt die Job-ID zurück. */
export async function startSeparation(audioUrl: string): Promise<string> {
  if (isMock()) {
    const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    mockJobs.set(id, { startedAt: Date.now(), audioUrl });
    return id;
  }
  const prediction = await client().predictions.create({
    version: requireEnv("REPLICATE_DEMUCS_VERSION"),
    // Key-Namen ggf. an das echte Input-Schema anpassen (siehe Task 6 Step 1 im Plan)
    input: { audio: audioUrl, model: "htdemucs_6s", output_format: "mp3" },
  });
  return prediction.id;
}

export async function getPredictionRaw(id: string): Promise<RawPrediction> {
  if (isMock()) return mockPrediction(id);
  return (await client().predictions.get(id)) as unknown as RawPrediction;
}

export async function getJob(id: string): Promise<JobStatus> {
  if (isLocalJobId(id)) return getLocalJob(id);
  return mapPrediction(await getPredictionRaw(id));
}

/** Quell-URL einer fertigen Spur (Replicate-CDN bzw. Mock-URL) für die Proxy-Route. */
export async function getStemSourceUrl(id: string, stem: StemName): Promise<string | null> {
  const p = await getPredictionRaw(id);
  if (p.status !== "succeeded") return null;
  return ((p.output ?? {}) as Record<string, string>)[stem] ?? null;
}
