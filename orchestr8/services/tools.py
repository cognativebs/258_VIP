"""Read-only repo tools for Orchestr8 (ADR 0003 · O1).

Autonomy 0: Orchestr8 never writes or executes. Grantable tools are only:
  read_file, list_dir, grep, git_diff

Every call is checked against the calling agent's ``contract.yaml``
``allowed_tools``. Paths are confined to the VIP repo root; secrets are blocked.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

from services.contracts import load_contract

# Repo root = parent of orchestr8/ (VIP monorepo).
ROOT = Path(__file__).resolve().parent.parent.parent
ORCHESTR8_ROOT = Path(__file__).resolve().parent.parent

GRANTABLE = frozenset({"read_file", "list_dir", "grep", "git_diff"})
BLOCKED_NAME_PATTERNS = (
    re.compile(r"(^|/|\\)\.env(\.|$)", re.I),
    re.compile(r"(^|/|\\)secrets?\.json$", re.I),
    re.compile(r"(^|/|\\)\.runs(/|\\|$)", re.I),
    re.compile(r"credentials", re.I),
)
MAX_READ_BYTES = 80_000
MAX_GREP_HITS = 40
MAX_LIST_ENTRIES = 80
MAX_DIFF_CHARS = 60_000


class ToolDenied(PermissionError):
    pass


def _resolve_under_root(rel_or_abs: str) -> Path:
    raw = (rel_or_abs or ".").strip() or "."
    path = Path(raw)
    if not path.is_absolute():
        path = (ROOT / path).resolve()
    else:
        path = path.resolve()
    try:
        path.relative_to(ROOT)
    except ValueError as e:
        raise ToolDenied(f"Path escapes repo root: {raw}") from e
    rel = path.relative_to(ROOT).as_posix()
    for pat in BLOCKED_NAME_PATTERNS:
        if pat.search(rel):
            raise ToolDenied(f"Blocked path: {rel}")
    return path


def assert_allowed(agent_id: str, tool: str) -> None:
    if tool not in GRANTABLE:
        raise ToolDenied(f"Tool {tool!r} is not grantable under Autonomy 0")
    contract = load_contract(agent_id)
    if contract is None:
        raise ToolDenied(f"No contract for agent {agent_id}")
    allowed = set(contract.get("allowed_tools") or [])
    if tool not in allowed:
        raise ToolDenied(f"Agent {agent_id} may not use {tool} (allowed={sorted(allowed) or 'none'})")


def read_file(agent_id: str, path: str, *, max_bytes: int = MAX_READ_BYTES) -> dict[str, Any]:
    assert_allowed(agent_id, "read_file")
    target = _resolve_under_root(path)
    if not target.is_file():
        raise FileNotFoundError(f"Not a file: {path}")
    data = target.read_bytes()
    truncated = len(data) > max_bytes
    text = data[:max_bytes].decode("utf-8", errors="replace")
    return {
        "tool": "read_file",
        "path": target.relative_to(ROOT).as_posix(),
        "bytes": len(data),
        "truncated": truncated,
        "content": text,
    }


def list_dir(agent_id: str, path: str = ".", *, max_entries: int = MAX_LIST_ENTRIES) -> dict[str, Any]:
    assert_allowed(agent_id, "list_dir")
    target = _resolve_under_root(path)
    if not target.is_dir():
        raise NotADirectoryError(f"Not a directory: {path}")
    entries = []
    for child in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if child.name.startswith(".") and child.name not in {".gitignore"}:
            continue
        if child.name in {"node_modules", "__pycache__", ".next", ".venv"}:
            continue
        kind = "dir" if child.is_dir() else "file"
        entries.append({"name": child.name, "kind": kind})
        if len(entries) >= max_entries:
            break
    return {
        "tool": "list_dir",
        "path": target.relative_to(ROOT).as_posix(),
        "entries": entries,
        "truncated": len(list(target.iterdir())) > len(entries),
    }


def grep(
    agent_id: str,
    pattern: str,
    path: str = ".",
    *,
    max_hits: int = MAX_GREP_HITS,
) -> dict[str, Any]:
    assert_allowed(agent_id, "grep")
    target = _resolve_under_root(path)
    try:
        rx = re.compile(pattern)
    except re.error as e:
        raise ValueError(f"Invalid regex: {e}") from e

    hits: list[dict[str, Any]] = []
    files: list[Path] = []
    if target.is_file():
        files = [target]
    else:
        for p in target.rglob("*"):
            if not p.is_file():
                continue
            rel = p.relative_to(ROOT).as_posix()
            if any(seg in rel for seg in ("node_modules/", ".next/", "__pycache__/", ".git/", ".venv/")):
                continue
            if p.suffix.lower() not in {
                ".py", ".ts", ".tsx", ".js", ".jsx", ".md", ".yaml", ".yml",
                ".json", ".sql", ".css", ".txt", ".toml",
            }:
                continue
            files.append(p)
            if len(files) > 400:
                break

    for fp in files:
        try:
            lines = fp.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for i, line in enumerate(lines, 1):
            if rx.search(line):
                hits.append(
                    {
                        "path": fp.relative_to(ROOT).as_posix(),
                        "line": i,
                        "text": line[:240],
                    }
                )
                if len(hits) >= max_hits:
                    return {
                        "tool": "grep",
                        "pattern": pattern,
                        "path": target.relative_to(ROOT).as_posix(),
                        "hits": hits,
                        "truncated": True,
                    }
    return {
        "tool": "grep",
        "pattern": pattern,
        "path": target.relative_to(ROOT).as_posix(),
        "hits": hits,
        "truncated": False,
    }


def git_diff(agent_id: str, *, staged: bool = False, path: str | None = None) -> dict[str, Any]:
    assert_allowed(agent_id, "git_diff")
    cmd = ["git", "diff"]
    if staged:
        cmd.append("--cached")
    if path:
        target = _resolve_under_root(path)
        cmd.extend(["--", str(target)])
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        raise RuntimeError(f"git diff failed: {e}") from e
    out = (proc.stdout or "") + (proc.stderr or "")
    truncated = len(out) > MAX_DIFF_CHARS
    return {
        "tool": "git_diff",
        "staged": staged,
        "path": path,
        "exit_code": proc.returncode,
        "truncated": truncated,
        "diff": out[:MAX_DIFF_CHARS],
    }


def call_tool(agent_id: str, tool: str, **kwargs: Any) -> dict[str, Any]:
    """Dispatch a single tool call with contract enforcement."""
    dispatch = {
        "read_file": lambda: read_file(agent_id, kwargs.get("path", ".")),
        "list_dir": lambda: list_dir(agent_id, kwargs.get("path", ".")),
        "grep": lambda: grep(agent_id, kwargs["pattern"], kwargs.get("path", ".")),
        "git_diff": lambda: git_diff(
            agent_id, staged=bool(kwargs.get("staged")), path=kwargs.get("path")
        ),
    }
    if tool not in dispatch:
        raise ToolDenied(f"Unknown tool: {tool}")
    return dispatch[tool]()


def gather_build_context(agent_id: str = "architect") -> str:
    """Deterministic repo context pack for build_spec jobs (read-only).

    Runs only tools the agent is allowed to use. Failures are recorded, not raised,
    so a missing tool grant never blocks the job.
    """
    sections: list[str] = []
    calls = [
        ("list_dir", {"path": "."}),
        ("list_dir", {"path": "orchestr8"}),
        ("list_dir", {"path": "docs"}),
        ("list_dir", {"path": "packages"}),
        ("read_file", {"path": "AGENTS.md"}),
        ("read_file", {"path": "docs/backlog.md"}),
        ("read_file", {"path": "docs/adr/0003-orchestr8-authors-cursor-builds.md"}),
        ("grep", {"pattern": "build_spec|allowed_tools|runstore|Challenge Council", "path": "orchestr8"}),
        ("grep", {"pattern": "^## Now|^## Next|Phase O", "path": "docs/backlog.md"}),
        ("git_diff", {}),
    ]
    for tool, kwargs in calls:
        try:
            result = call_tool(agent_id, tool, **kwargs)
        except ToolDenied as e:
            sections.append(f"### {tool} DENIED\n{e}")
            continue
        except Exception as e:  # noqa: BLE001
            sections.append(f"### {tool} ERROR\n{e}")
            continue

        if tool == "read_file":
            sections.append(
                f"### read_file {result['path']}"
                f"{' (truncated)' if result.get('truncated') else ''}\n"
                f"```\n{result['content']}\n```"
            )
        elif tool == "list_dir":
            lines = [f"- {e['kind']}: {e['name']}" for e in result["entries"]]
            sections.append(f"### list_dir {result['path']}\n" + "\n".join(lines))
        elif tool == "grep":
            lines = [f"{h['path']}:{h['line']}: {h['text']}" for h in result["hits"]]
            sections.append(
                f"### grep /{result['pattern']}/ in {result['path']}\n"
                + ("\n".join(lines) if lines else "(no hits)")
            )
        elif tool == "git_diff":
            body = result.get("diff") or "(clean working tree)"
            sections.append(f"### git_diff\n```\n{body}\n```")

    return (
        "REPO CONTEXT (read-only tools; Autonomy 0 — do not invent paths).\n\n"
        + "\n\n".join(sections)
    )
