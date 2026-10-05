"""Streamed jobs: heartbeats say what is in flight, and a client that stops the job stops the spending."""
from __future__ import annotations

import http.client
import json
import os
import sys
import threading
import time

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_ROOT = os.path.join(REPO_ROOT, "orchestr8")
if ORCH_ROOT not in sys.path:
    sys.path.insert(0, ORCH_ROOT)

from services.job_monitor import JobCancelled, JobMonitor  # noqa: E402


def test_snapshot_reports_in_flight_calls_finished_roles_and_spend():
    now = [100.0]
    m = JobMonitor(clock=lambda: now[0])
    m.call_started(role="researcher", label="Researcher", provider="Anthropic", model="Claude", attempt=1, timeout_s=192)
    now[0] = 142.0
    snap = m.snapshot()
    assert snap["inFlight"] == [
        {"role": "researcher", "label": "Researcher", "provider": "Anthropic", "model": "Claude", "attempt": 1, "timeoutS": 192, "seconds": 42.0}
    ]
    m.call_finished(role="researcher", step={"role_label": "Researcher", "costUsd": 0.0123, "usage": {"output": 900}})
    snap = m.snapshot()
    assert snap["inFlight"] == []
    assert snap["done"][0] == {"role": "researcher", "label": "Researcher", "seconds": 42.0, "costUsd": 0.0123, "outputTokens": 900, "error": False}
    assert snap["spentUsd"] == 0.0123 and snap["modelCalls"] == 1 and snap["elapsedS"] == 42.0


def test_cancel_stops_before_the_next_call():
    m = JobMonitor()
    m.check("researcher")
    m.cancel()
    with pytest.raises(JobCancelled, match="before critic"):
        m.check("critic")


def test_cancelled_pipeline_calls_no_further_role(monkeypatch):
    pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")
    from services import orchestrator as orch

    monitor = JobMonitor()
    calls: list[str] = []

    def fake_chat(**kwargs):
        calls.append(kwargs["model"])
        monitor.cancel()  # the operator presses Stop while the first role is answering
        return {"text": "ok", "usage": {"input": 10, "output": 10, "total": 20}}

    monkeypatch.setattr(orch, "chat_role", fake_chat)
    with pytest.raises(JobCancelled):
        orch._execute_job(
            task="general",
            roles=["researcher", "critic"],
            mode="pipeline",
            question="Hold or sell?",
            context_json="{}",
            monitor=monitor,
        )
    assert len(calls) == 1
    assert len(monitor.snapshot()["done"]) == 1


def _serve(monkeypatch, fake_run_job):
    from api import server as srv

    monkeypatch.setattr(srv, "HEARTBEAT_S", 0.05)
    monkeypatch.setattr(srv, "run_job", fake_run_job)
    httpd = srv.ThreadingHTTPServer(("127.0.0.1", 0), srv.GatewayHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def _post_stream(port: int) -> http.client.HTTPResponse:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    body = json.dumps({"task": "general", "roles": ["researcher", "critic"], "mode": "pipeline", "input": {"question": "q"}})
    conn.request("POST", "/v1/jobs/stream", body=body, headers={"Content-Type": "application/json"})
    return conn.getresponse()


def _events(resp: http.client.HTTPResponse) -> list[dict]:
    out = []
    for raw in resp.read().decode("utf-8").split("\n\n"):
        line = next((l for l in raw.split("\n") if l.startswith("data:")), None)
        if line:
            out.append(json.loads(line[5:]))
    return out


def test_stream_sends_heartbeats_with_in_flight_calls(monkeypatch):
    pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")

    def fake_run_job(*, monitor, on_step, **_):
        monitor.call_started(role="researcher", label="Researcher", provider="Anthropic", model="Claude", attempt=1, timeout_s=120)
        time.sleep(0.3)
        step = {"role": "researcher", "role_label": "Researcher", "costUsd": 0.01, "usage": {"output": 5}}
        monitor.call_finished(role="researcher", step=step)
        on_step(step)
        return {"text": "done", "runId": "run_test"}

    httpd = _serve(monkeypatch, fake_run_job)
    try:
        events = _events(_post_stream(httpd.server_address[1]))
    finally:
        httpd.shutdown()
    types = [e["type"] for e in events]
    assert types[0] == "start" and types[-1] == "done" and "step" in types
    beats = [e for e in events if e["type"] == "heartbeat"]
    assert any(b["inFlight"] and b["inFlight"][0]["role"] == "researcher" for b in beats)
    assert beats[-1]["spentUsd"] == 0.01 and beats[-1]["inFlight"] == []


def test_disconnect_cancels_the_job(monkeypatch):
    pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")
    seen: dict = {}
    finished = threading.Event()

    def fake_run_job(*, monitor, **_):
        seen["monitor"] = monitor
        try:
            for role in ["researcher", "analyst", "critic", "synthesizer"] * 50:
                monitor.check(role)
                seen.setdefault("called", []).append(role)
                time.sleep(0.05)
        finally:
            finished.set()
        return {"text": "should not get here"}

    httpd = _serve(monkeypatch, fake_run_job)
    try:
        resp = _post_stream(httpd.server_address[1])
        resp.fp.readline()  # the start frame arrives
        resp.close()
        assert finished.wait(5), "job kept running after the client left"
    finally:
        httpd.shutdown()
    assert seen["monitor"].cancelled
    assert len(seen["called"]) < 200
