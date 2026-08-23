"""Managed Agents session scaffold — stream-first loop, no live API."""
from __future__ import annotations

import io
import os
import sys
from types import SimpleNamespace

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_ROOT = os.path.join(REPO_ROOT, "apps", "managed-agent-session")
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from session_chat import print_agent_message, stream_session  # noqa: E402


class _Stream:
    def __init__(self, events):
        self._events = events

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        return iter(self._events)


class _Events:
    def __init__(self, events):
        self.sent = []
        self._events = events

    def stream(self, session_id):
        assert session_id == "sesn_test"
        return _Stream(self._events)

    def send(self, session_id, events):
        self.sent.append((session_id, events))


class _Sessions:
    def __init__(self, events):
        self.events = _Events(events)
        self.created = []

    def create(self, agent, environment_id):
        self.created.append((agent, environment_id))
        return SimpleNamespace(id="sesn_test", status="running")


class _Beta:
    def __init__(self, events):
        self.sessions = _Sessions(events)


class _Client:
    def __init__(self, events):
        self.beta = _Beta(events)


def test_prints_agent_message_and_finishes_on_idle():
    events = [
        SimpleNamespace(
            type="agent.message",
            content=[SimpleNamespace(type="text", text="Hello from the agent")],
        ),
        SimpleNamespace(type="session.status_idle"),
    ]
    client = _Client(events)
    out = io.StringIO()
    err = io.StringIO()
    code = stream_session(
        client,
        prompt="hi",
        agent_id="agent_01B8ziCmNADfRwKexa969qQg",
        environment_id="env_01HgSHypqTtC6hNjRwYEucLs",
        out=out,
        err=err,
    )
    assert code == 0
    assert "Hello from the agent" in out.getvalue()
    assert client.beta.sessions.created == [
        (
            {"type": "agent", "id": "agent_01B8ziCmNADfRwKexa969qQg"},
            "env_01HgSHypqTtC6hNjRwYEucLs",
        )
    ]
    sent = client.beta.sessions.events.sent
    assert sent[0][1][0]["type"] == "user.message"
    assert sent[0][1][0]["content"][0]["text"] == "hi"


def test_error_event_exits_nonzero():
    client = _Client([SimpleNamespace(type="session.status_error")])
    code = stream_session(
        client, prompt="hi", out=io.StringIO(), err=io.StringIO()
    )
    assert code == 1


def test_print_agent_message_reads_dict_blocks():
    out = io.StringIO()
    print_agent_message(
        {"type": "agent.message", "content": [{"type": "text", "text": "ok"}]},
        out=out,
    )
    assert out.getvalue() == "ok"
