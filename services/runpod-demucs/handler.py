import os

import runpod

from worker import DemucsSeparator, WorkerInputError, process_job

_SEPARATOR = DemucsSeparator(device=os.environ.get("DEMUCS_DEVICE", "cuda"))


def handler(job):
    job_input = job.get("input") if isinstance(job, dict) else None
    if not isinstance(job_input, dict):
        raise WorkerInputError("RunPod input fehlt oder ist kein Objekt")
    job_id = job.get("id") if isinstance(job.get("id"), str) else None
    return process_job(job_input, separator=_SEPARATOR, job_id=job_id)


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
