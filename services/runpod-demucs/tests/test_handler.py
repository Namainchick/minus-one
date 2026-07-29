import importlib
import sys

import pytest

import worker


def load_handler(monkeypatch):
    separator = object()
    monkeypatch.setenv("DEMUCS_DEVICE", "cpu")
    monkeypatch.setattr(worker, "DemucsSeparator", lambda device: separator)
    sys.modules.pop("handler", None)
    module = importlib.import_module("handler")
    assert module._SEPARATOR is separator
    return module


def test_handler_delegates_only_runpod_input(monkeypatch):
    module = load_handler(monkeypatch)
    captured = {}

    def fake_process(job_input, *, separator, job_id):
        captured["input"] = job_input
        captured["separator"] = separator
        captured["job_id"] = job_id
        return {"stems": {}}

    monkeypatch.setattr(module, "process_job", fake_process)
    job_input = {"audioUrl": "value", "uploads": {}}

    assert module.handler({"id": "job-1", "input": job_input}) == {"stems": {}}
    assert captured == {"input": job_input, "separator": module._SEPARATOR, "job_id": "job-1"}


@pytest.mark.parametrize("event", [None, {}, {"input": None}, {"input": []}])
def test_handler_rejects_missing_object_input(monkeypatch, event):
    module = load_handler(monkeypatch)

    with pytest.raises(worker.WorkerInputError, match="input"):
        module.handler(event)
