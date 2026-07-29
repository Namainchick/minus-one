from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Protocol
from urllib.parse import unquote, urlencode, urlparse

import requests

STEMS = ("vocals", "drums", "bass", "guitar", "piano", "other")
MAX_SOURCE_BYTES = 15 * 1024 * 1024
MAX_OUTPUT_BYTES = 20 * 1024 * 1024
SOURCE_TIMEOUT_SECONDS = 30
UPLOAD_TIMEOUT_SECONDS = 60
BLOB_API_URL = "https://vercel.com/api/blob/"
CHUNK_BYTES = 1024 * 1024
LOGGER = logging.getLogger("minus-one.runpod-worker")


class WorkerInputError(ValueError):
    pass


class Separator(Protocol):
    def separate(self, source: Path, output_dir: Path) -> None: ...


def _is_vercel_blob_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and parsed.hostname is not None
        and parsed.hostname.endswith(".public.blob.vercel-storage.com")
    )


def validate_source_url(url: object) -> str:
    if not isinstance(url, str) or not _is_vercel_blob_url(url):
        raise WorkerInputError("audioUrl muss eine öffentliche HTTPS-URL von Vercel Blob sein")
    return url


def _validate_upload_spec(stem: str, spec: object) -> dict[str, str]:
    if not isinstance(spec, Mapping):
        raise WorkerInputError(f'Upload-Spezifikation für Spur "{stem}" fehlt')
    pathname = spec.get("pathname")
    token = spec.get("token")
    if not isinstance(pathname, str) or not pathname or "//" in pathname:
        raise WorkerInputError(f'Upload-Pathname für Spur "{stem}" ist ungültig')
    if not isinstance(token, str) or not token.startswith("vercel_blob_client_"):
        raise WorkerInputError(f'Upload-Token für Spur "{stem}" ist ungültig')
    parts = token.split("_")
    if len(parts) < 5 or not parts[3]:
        raise WorkerInputError(f'Upload-Token für Spur "{stem}" enthält keine Store-ID')
    return {"pathname": pathname, "token": token}


def _validate_job_input(job_input: object) -> tuple[str, dict[str, dict[str, str]]]:
    if not isinstance(job_input, Mapping):
        raise WorkerInputError("RunPod input muss ein Objekt sein")
    audio_url = validate_source_url(job_input.get("audioUrl"))
    raw_uploads = job_input.get("uploads")
    if not isinstance(raw_uploads, Mapping):
        raise WorkerInputError("Upload-Spezifikationen fehlen")
    uploads = {stem: _validate_upload_spec(stem, raw_uploads.get(stem)) for stem in STEMS}
    return audio_url, uploads


def _require_success(response: object, action: str) -> None:
    status_code = getattr(response, "status_code", 0)
    if not isinstance(status_code, int) or not 200 <= status_code < 300:
        raise RuntimeError(f"{action}: HTTP {status_code}")


def download_source(url: str, destination: Path, *, session=requests) -> None:
    validate_source_url(url)
    written = 0
    try:
        with session.get(
            url,
            stream=True,
            timeout=SOURCE_TIMEOUT_SECONDS,
            allow_redirects=False,
        ) as response:
            _require_success(response, "Quelldownload fehlgeschlagen")

            content_length = response.headers.get("content-length")
            if content_length:
                try:
                    declared_size = int(content_length)
                except ValueError as error:
                    raise WorkerInputError("Ungültige Content-Length der Quelldatei") from error
                if declared_size > MAX_SOURCE_BYTES:
                    raise WorkerInputError("Quelldatei ist zu groß")

            with destination.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=CHUNK_BYTES):
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > MAX_SOURCE_BYTES:
                        raise WorkerInputError("Quelldatei ist zu groß")
                    handle.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    if written == 0:
        destination.unlink(missing_ok=True)
        raise WorkerInputError("Quelldatei ist leer")


def upload_stem(path: Path, spec: Mapping[str, str], *, session=requests) -> str:
    validated = _validate_upload_spec(path.stem, spec)
    size = path.stat().st_size
    if size <= 0:
        raise RuntimeError(f'Spur "{path.stem}" ist leer')
    if size > MAX_OUTPUT_BYTES:
        raise RuntimeError(f'Spur "{path.stem}" ist zu groß')

    token = validated["token"]
    store_id = token.split("_")[3]
    url = f"{BLOB_API_URL}?{urlencode({'pathname': validated['pathname']})}"
    headers = {
        "Authorization": f"Bearer {token}",
        "x-api-version": "12",
        "x-vercel-blob-store-id": store_id,
        "x-vercel-blob-access": "public",
        "x-content-type": "audio/mpeg",
    }
    with path.open("rb") as handle:
        response = session.put(
            url,
            headers=headers,
            data=handle,
            timeout=UPLOAD_TIMEOUT_SECONDS,
            allow_redirects=False,
        )
    _require_success(response, "Stem-Upload fehlgeschlagen")
    payload = response.json()
    result_url = payload.get("url") if isinstance(payload, Mapping) else None
    if not isinstance(result_url, str) or not _is_vercel_blob_url(result_url):
        raise RuntimeError("Vercel Blob lieferte keine gültige Blob-URL")
    result_pathname = unquote(urlparse(result_url).path).lstrip("/")
    if result_pathname != validated["pathname"]:
        raise RuntimeError("Vercel Blob lieferte nicht den angeforderten Pathname")
    return result_url


class DemucsSeparator:
    def __init__(self, device: str = "cuda") -> None:
        from demucs.api import Separator as DemucsApiSeparator

        self._separator = DemucsApiSeparator(model="htdemucs_6s", device=device, progress=True)

    def separate(self, source: Path, output_dir: Path) -> None:
        from demucs.audio import save_audio

        output_dir.mkdir(parents=True, exist_ok=True)
        _, separated = self._separator.separate_audio_file(source)
        for stem in STEMS:
            waveform = separated.get(stem)
            if waveform is None:
                raise RuntimeError(f'Demucs-Ergebnis enthält Spur "{stem}" nicht')
            save_audio(
                waveform,
                output_dir / f"{stem}.mp3",
                self._separator.samplerate,
                bitrate=192,
            )


def process_job(
    job_input: object,
    *,
    separator: Separator,
    download: Callable[[str, Path], None] = download_source,
    upload: Callable[[Path, Mapping[str, str]], str] = upload_stem,
    job_id: str | None = None,
) -> dict[str, object]:
    audio_url, uploads = _validate_job_input(job_input)
    safe_job_id = job_id if isinstance(job_id, str) and job_id.replace("-", "").replace("_", "").isalnum() else "local"
    LOGGER.info("job=%s stage=validated", safe_job_id)
    suffix = Path(urlparse(audio_url).path).suffix.lower()
    if suffix not in {".mp3", ".wav", ".m4a"}:
        suffix = ".audio"

    with TemporaryDirectory(prefix="minus-one-runpod-") as temp:
        temp_root = Path(temp)
        source = temp_root / f"source{suffix}"
        output_dir = temp_root / "stems"
        LOGGER.info("job=%s stage=download", safe_job_id)
        download(audio_url, source)
        LOGGER.info("job=%s stage=separate", safe_job_id)
        separator.separate(source, output_dir)

        stem_urls: dict[str, str] = {}
        LOGGER.info("job=%s stage=upload", safe_job_id)
        for stem in STEMS:
            path = output_dir / f"{stem}.mp3"
            if not path.is_file():
                raise RuntimeError(f'Spur "{stem}" fehlt im Demucs-Ergebnis')
            size = path.stat().st_size
            if size <= 0:
                raise RuntimeError(f'Spur "{stem}" ist leer')
            if size > MAX_OUTPUT_BYTES:
                raise RuntimeError(f'Spur "{stem}" ist zu groß')
            stem_urls[stem] = upload(path, uploads[stem])

        LOGGER.info("job=%s stage=complete", safe_job_id)
        return {"inputUrl": audio_url, "stems": stem_urls}
