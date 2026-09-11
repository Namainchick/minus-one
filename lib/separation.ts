import { getLocalJob, isLocalJobId } from "./local-demucs";
import {
  getJob as getReplicateJob,
  getStemSourceUrl as getReplicateStemSourceUrl,
  startSeparation as startReplicateSeparation,
  type JobStatus,
} from "./replicate";
import { getRunpodJob, getRunpodStemSourceUrl, startRunpodSeparation } from "./runpod";
import type { StemName } from "./stems";

export type { JobStatus };

type SeparationProvider = "replicate" | "runpod";

function selectedProvider(): SeparationProvider {
  const value = process.env.SEPARATION_PROVIDER ?? "replicate";
  if (value === "replicate" || value === "runpod") return value;
  throw new Error(`SEPARATION_PROVIDER is invalid: ${value}`);
}

export async function startSeparation(audioUrl: string): Promise<string> {
  return selectedProvider() === "runpod"
    ? startRunpodSeparation(audioUrl)
    : startReplicateSeparation(audioUrl);
}

export async function getJob(id: string): Promise<JobStatus> {
  if (isLocalJobId(id)) return getLocalJob(id);
  return selectedProvider() === "runpod" ? getRunpodJob(id) : getReplicateJob(id);
}

export async function getStemSourceUrl(id: string, stem: StemName): Promise<string | null> {
  if (isLocalJobId(id)) return null;
  return selectedProvider() === "runpod"
    ? getRunpodStemSourceUrl(id, stem)
    : getReplicateStemSourceUrl(id, stem);
}
