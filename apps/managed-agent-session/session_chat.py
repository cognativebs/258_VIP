"""Minimal Anthropic Managed Agents session client.

Talks to a pre-created agent + environment. Does not call agents.create.
Follows the official stream-first pattern from the managed-agents skill:

  1. client.beta.sessions.create
  2. open client.beta.sessions.events.stream
  3. send user.message via client.beta.sessions.events.send
  4. print agent.message text; exit on session.status_idle or error

The session client runs on the operator's PC. The agent tools run in
Anthropic's sandbox — they cannot see D: or C:\\258Labs. Self-hosted
environments also reject `file` / `github_repository` resources (HTTP 400).
This client never sends `resources`. Mission prompts get a clone stanza
for the public 258_VIP tree. See docs/how-to/09-claude-ma-wsl.md.
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
# Operator-placed tree (Windows launcher / client cwd). Not visible to MA tools.
REPO_WINDOWS = os.environ.get("ORCHESTR8_WINDOWS_PATH", r"C:\258Labs\orchestr8")
REPO_WSL = os.environ.get("ORCHESTR8_WSL_PATH", "/mnt/c/258Labs/orchestr8")
REPO_CLONE_URL = os.environ.get(
    "ORCHESTR8_CLONE_URL", "https://github.com/cognativebs/258_VIP.git"
)

REPO_ACCESS_PREAMBLE = f"""REPO ACCESS
You are in Anthropic's Managed Agents sandbox, not on the operator's Windows or WSL disk.
D:\\Projects\\... and C:\\258Labs\\orchestr8 are invisible here. Metadata paths are hints only.
If orchestr8/ and AGENTS.md are not already in the working tree, run:
  git clone {REPO_CLONE_URL}
That public repository IS 258 Labs' Orchestr8 / VIP tree. Do not search for some other
project named orchestr8. Do not ask for a zip, upload, or GitHub token for this clone.
Then do the mission below."""


def session_metadata(
    *,
    windows_path: str = REPO_WINDOWS,
    wsl_path: str = REPO_WSL,
) -> dict[str, str]:
    """Hint paths for the already-placed repo. Never a mount request."""
    return {
        "repo_windows": windows_path,
        "repo_wsl": wsl_path,
    }


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


def load_prompt_file(path: str) -> str:
    """Load a mission file. Prefer a fenced block whose body starts with MISSION."""
    text = open(path, encoding="utf-8").read()
    chunks = text.split("```")
    for i in range(1, len(chunks), 2):
        raw = chunks[i]
        if "\n" in raw:
            first, rest = raw.split("\n", 1)
            body = rest if first.strip() else raw
            if first.strip() and first.strip() not in {"text", "markdown"}:
                if not rest.strip().startswith("MISSION"):
                    continue
                body = rest
        else:
            body = raw
        stripped = body.strip()
        if stripped.startswith("MISSION"):
            return stripped
    return text.strip()


def attach_repo_access(prompt: str) -> str:
    """Missions get an explicit public clone URL. Short hellos are left alone."""
    text = prompt.strip()
    if not text.startswith("MISSION"):
        return text
    if REPO_CLONE_URL in text:
        return text
    return f"{REPO_ACCESS_PREAMBLE}\n\n{text}"


def parse_cli_args(argv: list[str]) -> str:
    if len(argv) >= 2 and argv[0] in {"--file", "-f"}:
        return attach_repo_access(load_prompt_file(argv[1]))
    return attach_repo_access(
        " ".join(argv).strip() or "Hello — introduce yourself in one sentence."
    )


def format_cli_error(exc: BaseException) -> str:
    """Human-readable chain for SDK 'Connection error.' wrappers."""
    parts = [f"{type(exc).__name__}: {exc}"]
    cause: BaseException | None = exc.__cause__ or exc.__context__
    seen: set[int] = set()
    while cause is not None and id(cause) not in seen:
        seen.add(id(cause))
        parts.append(f"  caused by {type(cause).__name__}: {cause}")
        cause = cause.__cause__ or cause.__context__
    if "connection error" in str(exc).lower():
        parts.append(
            "  hint: cwd must be the repo (C:\\258Labs\\orchestr8 or /mnt/c/258Labs/orchestr8), "
            "ANTHROPIC_API_KEY set in THIS shell, "
            "and https://api.anthropic.com reachable (VPN/proxy/firewall)."
        )
    return "\n".join(parts)


def require_api_key() -> str | None:
    key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if key:
        return None
    return "ANTHROPIC_API_KEY is not set in this shell."


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
    # Do not pass resources= — self-hosted rejects file / github_repository (400).
    session = client.beta.sessions.create(
        agent={"type": "agent", "id": agent_id},
        environment_id=environment_id,
        metadata=session_metadata(),
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
    try:
        prompt = parse_cli_args(args)
    except OSError as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2
    missing = require_api_key()
    if missing:
        sys.stderr.write(f"error: {missing}\n")
        return 2
    try:
        import anthropic

        client = anthropic.Anthropic()
        return stream_session(client, prompt=prompt)
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted.\n")
        return 130
    except Exception as exc:  # noqa: BLE001 — CLI must exit cleanly
        sys.stderr.write(f"error: {format_cli_error(exc)}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
