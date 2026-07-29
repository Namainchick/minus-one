from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from worker import (
    MAX_OUTPUT_BYTES,
    STEMS,
    WorkerInputError,
    download_source,
    process_job,
    upload_stem,
    validate_source_url,
)

SOURCE_URL = "https://source.public.blob.vercel-storage.com/uploads/song.mp3"
TOKEN = "vercel_blob_client_store123_secret456"


def valid_job_input():
    return {
        "audioUrl": SOURCE_URL,
        "uploads": {
            stem: {
                "pathname": f"runpod/output-1/{stem}.mp3",
                "token": TOKEN,
            }
            for stem in STEMS
        },
    }


class FakeResponse:
    def __init__(self, *, status_code=200, chunks=(), headers=None, payload=None):
        self.status_code = status_code
        self._chunks = chunks
        self.headers = headers or {}
        self._payload = payload or {}
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.closed = True

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def iter_content(self, chunk_size):
        del chunk_size
        yield from self._chunks

    def json(self):
        return self._payload


class FakeSeparator:
    def __init__(self, *, missing=None, oversized=None):
        self.missing = missing
        self.oversized = oversized
        self.temp_root = None

    def separate(self, source: Path, output_dir: Path):
        assert source.read_bytes() == b"audio"
        self.temp_root = output_dir.parent
        output_dir.mkdir(parents=True, exist_ok=True)
        for stem in STEMS:
            if stem == self.missing:
                continue
            output = output_dir / f"{stem}.mp3"
            if stem == self.oversized:
                with output.open("wb") as handle:
                    handle.truncate(MAX_OUTPUT_BYTES + 1)
            else:
                output.write_bytes(stem.encode())


def fake_download(_url: str, destination: Path):
    destination.write_bytes(b"audio")


def fake_upload(path: Path, spec: dict[str, str]):
    assert path.read_bytes()
    return f"https://results.public.blob.vercel-storage.com/{spec['pathname']}"


def test_rejects_non_vercel_source_url():
    with pytest.raises(WorkerInputError, match="Vercel Blob"):
        validate_source_url("https://example.com/song.mp3")


@pytest.mark.parametrize(
    "url",
    [
        "http://source.public.blob.vercel-storage.com/song.mp3",
        "https://public.blob.vercel-storage.com/song.mp3",
        "not-a-url",
    ],
)
def test_rejects_insecure_or_malformed_source_urls(url):
    with pytest.raises(WorkerInputError):
        validate_source_url(url)


def test_process_job_returns_all_stem_urls_and_cleans_temp_dir():
    separator = FakeSeparator()
    job_input = valid_job_input()
    uploaded_pairs = []

    def paired_upload(path, spec):
        uploaded_pairs.append((path.name, spec["pathname"]))
        return fake_upload(path, spec)

    output = process_job(job_input, separator=separator, download=fake_download, upload=paired_upload)

    assert set(output["stems"]) == set(STEMS)
    for stem in STEMS:
        assert output["stems"][stem].endswith(f"/{stem}.mp3")
    assert uploaded_pairs == [(f"{stem}.mp3", f"runpod/output-1/{stem}.mp3") for stem in STEMS]
    assert output["inputUrl"] == SOURCE_URL
    assert separator.temp_root is not None
    assert not separator.temp_root.exists()


def test_process_job_logs_job_id_and_safe_stage_names(caplog):
    caplog.set_level("INFO")

    process_job(
        valid_job_input(),
        separator=FakeSeparator(),
        download=fake_download,
        upload=fake_upload,
        job_id="runpod-job-1",
    )

    messages = [record.message for record in caplog.records]
    assert any("job=runpod-job-1 stage=download" in message for message in messages)
    assert any("job=runpod-job-1 stage=complete" in message for message in messages)
    assert TOKEN not in " ".join(messages)


def test_process_job_requires_every_upload_spec_before_downloading():
    job_input = valid_job_input()
    del job_input["uploads"]["piano"]
    download_called = False

    def tracked_download(url, destination):
        nonlocal download_called
        download_called = True
        fake_download(url, destination)

    with pytest.raises(WorkerInputError, match="piano"):
        process_job(job_input, separator=FakeSeparator(), download=tracked_download, upload=fake_upload)
    assert download_called is False


def test_process_job_fails_when_separator_omits_a_stem():
    with pytest.raises(RuntimeError, match="guitar"):
        process_job(valid_job_input(), separator=FakeSeparator(missing="guitar"), download=fake_download, upload=fake_upload)


def test_process_job_rejects_oversized_output_and_cleans_temp_dir():
    separator = FakeSeparator(oversized="other")

    with pytest.raises(RuntimeError, match="other"):
        process_job(valid_job_input(), separator=separator, download=fake_download, upload=fake_upload)

    assert separator.temp_root is not None
    assert not separator.temp_root.exists()


def test_download_disables_redirects_and_closes_response(tmp_path):
    captured = {}
    response = FakeResponse(chunks=(b"audio",))

    class Session:
        def get(self, url, **kwargs):
            captured["url"] = url
            captured.update(kwargs)
            return response

    download_source(SOURCE_URL, tmp_path / "song.mp3", session=Session())

    assert captured["allow_redirects"] is False
    assert response.closed is True


def test_download_rejects_redirect_response(tmp_path):
    response = FakeResponse(status_code=302, chunks=(b"redirect",))

    class Session:
        def get(self, *args, **kwargs):
            return response

    with pytest.raises(RuntimeError, match="HTTP 302"):
        download_source(SOURCE_URL, tmp_path / "song.mp3", session=Session())
    assert response.closed is True


def test_download_rejects_declared_oversized_source(tmp_path):
    response = FakeResponse(headers={"content-length": str(16 * 1024 * 1024)})

    class Session:
        def get(self, *args, **kwargs):
            return response

    with pytest.raises(WorkerInputError, match="groß"):
        download_source(SOURCE_URL, tmp_path / "song.mp3", session=Session())
    assert response.closed is True


def test_download_rejects_stream_that_exceeds_limit(tmp_path):
    class Session:
        def get(self, *args, **kwargs):
            return FakeResponse(chunks=(b"x" * (8 * 1024 * 1024), b"x" * (8 * 1024 * 1024)))

    destination = tmp_path / "song.mp3"
    with pytest.raises(WorkerInputError, match="groß"):
        download_source(SOURCE_URL, destination, session=Session())
    assert not destination.exists()


def test_partial_upload_failure_fails_job_and_cleans_temp_dir():
    separator = FakeSeparator()

    def failing_upload(path, spec):
        if path.stem == "guitar":
            raise RuntimeError("upload failed")
        return fake_upload(path, spec)

    with pytest.raises(RuntimeError, match="upload failed"):
        process_job(valid_job_input(), separator=separator, download=fake_download, upload=failing_upload)

    assert separator.temp_root is not None
    assert not separator.temp_root.exists()


def test_upload_uses_scoped_token_headers_and_exact_pathname(tmp_path):
    stem = tmp_path / "vocals.mp3"
    stem.write_bytes(b"mp3")
    captured = {}

    class Session:
        def put(self, url, **kwargs):
            captured["url"] = url
            captured.update(kwargs)
            return FakeResponse(
                payload={"url": "https://results.public.blob.vercel-storage.com/runpod/output%201/vocals.mp3"}
            )

    result = upload_stem(
        stem,
        {"pathname": "runpod/output 1/vocals.mp3", "token": TOKEN},
        session=Session(),
    )

    parsed = urlparse(captured["url"])
    assert parse_qs(parsed.query)["pathname"] == ["runpod/output 1/vocals.mp3"]
    assert captured["headers"] == {
        "Authorization": f"Bearer {TOKEN}",
        "x-api-version": "12",
        "x-vercel-blob-store-id": "store123",
        "x-vercel-blob-access": "public",
        "x-content-type": "audio/mpeg",
    }
    assert captured["timeout"] == 60
    assert captured["allow_redirects"] is False
    assert result.endswith("/runpod/output%201/vocals.mp3")


def test_upload_rejects_invalid_token_and_result_url(tmp_path):
    stem = tmp_path / "vocals.mp3"
    stem.write_bytes(b"mp3")

    with pytest.raises(WorkerInputError, match="Token"):
        upload_stem(stem, {"pathname": "vocals.mp3", "token": "secret"})
    with pytest.raises(WorkerInputError, match="Store-ID"):
        upload_stem(stem, {"pathname": "vocals.mp3", "token": "vercel_blob_client__secret"})

    class RedirectSession:
        def put(self, *args, **kwargs):
            return FakeResponse(status_code=307)

    with pytest.raises(RuntimeError, match="HTTP 307"):
        upload_stem(stem, {"pathname": "vocals.mp3", "token": TOKEN}, session=RedirectSession())

    class WrongHostSession:
        def put(self, *args, **kwargs):
            return FakeResponse(payload={"url": "https://example.com/vocals.mp3"})

    with pytest.raises(RuntimeError, match="Blob-URL"):
        upload_stem(stem, {"pathname": "vocals.mp3", "token": TOKEN}, session=WrongHostSession())

    class WrongPathSession:
        def put(self, *args, **kwargs):
            return FakeResponse(payload={"url": "https://results.public.blob.vercel-storage.com/bass.mp3"})

    with pytest.raises(RuntimeError, match="Pathname"):
        upload_stem(stem, {"pathname": "vocals.mp3", "token": TOKEN}, session=WrongPathSession())


def test_download_rejects_empty_source_and_removes_file(tmp_path):
    response = FakeResponse(chunks=())

    class Session:
        def get(self, *args, **kwargs):
            return response

    destination = tmp_path / "song.mp3"
    with pytest.raises(WorkerInputError, match="leer"):
        download_source(SOURCE_URL, destination, session=Session())
    assert not destination.exists()
    assert response.closed is True
