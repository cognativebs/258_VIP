"""Minimal Anthropic Managed Agents session client.

Talks to a pre-created agent + environment. Does not call agents.create.
Follows the official stream-first pattern from the managed-agents skill:

  1. client.beta.sessions.create
  2. open client.beta.sessions.events.stream
  3. send user.message via client.beta.sessions.events.send
  4. print agent.message text; exit on session.status_idle or error
"""
from __future__ import annotations

import os
import sys
from collections.abc import Iterable
from typing import Any, TextIO

AGENT_ID = os.environ.get("ANTHROPIC_AGENT_ID", "agent_01B8ziCmNADfRwKexa969qQg")
ENVIRONMENT_ID = os.environ.get(
    "ANTHROPIC_ENVIRONMENT_ID", "env_01HgSHypqTtC6hNjRwYEucLs"
)


def _event_type(event: Any) -> str:
    if isinstance(event, dict):
        return str(event.get("type") or "")
    return str(getattr(event, "type", "") or "")


def _text_blocks(event: Any) -> Iterable[str]:
    content = event.get("content") if isinstance(event, dict) else getattr(event, "content", None)
    if not content:
        return
    for block in content:
        if isinstance(block, dict):
            if block.get("type") == "text" and block.get("text"):
                yield str(block["text"])
            continue
        if getattr(block, "type", None) == "text":
            text = getattr(block, "text", "")
            if text:
                yield str(text)


def print_agent_message(event: Any, out: TextIO = sys.stdout) -> None:
    for text in _text_blocks(event):
        out.write(text)
        out.flush()


def stream_session(
    client: Any,
    *,
    prompt: str,
    agent_id: str = AGENT_ID,
    environment_id: str = ENVIRONMENT_ID,
    out: TextIO = sys.stdout,
    err: TextIO = sys.stderr,
) -> int:
    """Create a session, stream events, print agent text. Returns a process exit code."""
    session = client.beta.sessions.create(
        agent={"type": "agent", "id": agent_id},
        environment_id=environment_id,
    )
    session_id = getattr(session, "id", None) or session.get("id")
    err.write(f"session {session_id}\n")
    err.flush()

    with client.beta.sessions.events.stream(session_id=session_id) as stream:
        client.beta.sessions.events.send(
            session_id=session_id,
            events=[
                {
                    "type": "user.message",
                    "content": [{"type": "text", "text": prompt}],
                }
            ],
        )
        for event in stream:
            etype = _event_type(event)
            if etype == "agent.message":
                print_agent_message(event, out=out)
            elif etype == "session.status_idle":
                out.write("\n")
                out.flush()
                return 0
            elif etype in {"session.status_terminated", "session.status_error", "error"}:
                err.write(f"{etype}\n")
                err.flush()
                return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    prompt = " ".join(args).strip() or "Hello — introduce yourself in one sentence."
    try:
        import anthropic

        client = anthropic.Anthropic()
        return stream_session(client, prompt=prompt)
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted.\n")
        return 130
    except Exception as exc:  # noqa: BLE001 — CLI must exit cleanly
        sys.stderr.write(f"error: {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
