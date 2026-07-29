from __future__ import annotations

import argparse
import hashlib
import time
from pathlib import Path

from worker import MAX_OUTPUT_BYTES, STEMS, DemucsSeparator


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the RunPod Demucs separator against a local audio file")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--device", default="cpu", choices=("cpu", "cuda", "mps"))
    args = parser.parse_args()

    source = args.input.resolve()
    output = args.output.resolve()
    if not source.is_file():
        parser.error(f"input file does not exist: {source}")
    output.mkdir(parents=True, exist_ok=True)

    started_at = time.perf_counter()
    separator = DemucsSeparator(device=args.device)
    separator.separate(source, output)

    hashes = set()
    for stem in STEMS:
        path = output / f"{stem}.mp3"
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f'local smoke test did not produce stem "{stem}"')
        if path.stat().st_size > MAX_OUTPUT_BYTES:
            raise RuntimeError(f'local smoke stem "{stem}" exceeds the production size limit')
        hashes.add(hashlib.sha256(path.read_bytes()).digest())
        print(f"{stem}: {path} ({path.stat().st_size} bytes)")
    if len(hashes) != len(STEMS):
        raise RuntimeError("local smoke test produced duplicate stem files")

    elapsed = time.perf_counter() - started_at
    print(f"Local Demucs smoke test completed in {elapsed:.1f}s on {args.device}.")


if __name__ == "__main__":
    main()
