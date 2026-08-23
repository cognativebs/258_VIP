"""Immutable run + artifact persistence (ADR 0002 · O0).

Every orchestration job is captured as a run bundle: roles, models, full trace,
cost, vote, and provenance (which contract versions produced it). Bundles are
written once to ``.runs/<run_id>.json`` and never mutated (AGENTS.md rule 3);
an append-only ``index.jsonl`` gives a cheap, scannable history.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from services.contracts import list_contracts, validate_instance

ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = ROOT / ".runs"
SCHEMA_PATH = ROOT / "config" / "run.schema.json"
ORCHESTR8_VERSION = "0.1.0"


@lru_cache(maxsize=1)
def _schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def new_run_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    return f"run_{stamp}_{uuid.uuid4().hex[:8]}"


def build_bundle(
    *,
    result: dict,
    task: str,
    question: str,
    context_json: str,
    run_id: str | None = None,
) -> dict:
    """Assemble a schema-conformant run bundle from run_job output."""
    roles = result.get("roles") or []
    contracts = list_contracts()
    contract_versions = {r: (contracts.get(r) or {}).get("version") for r in roles}
    vote = result.get("vote") or {}
    paused = bool(result.get("paused"))
    bundle = {
        "run_id": run_id or new_run_id(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "orchestr8_version": ORCHESTR8_VERSION,
        "task": task,
        "mode": result.get("mode", "single"),
        "roles": roles,
        "question": question or "",
        "context_bytes": len((context_json or "").encode("utf-8")),
        "final_text": result.get("text", ""),
        "trace": result.get("trace", []),
        "usage": result.get("usage", {}),
        "provenance": {
            "contract_versions": contract_versions,
            "model_overrides": result.get("modelOverrides", {}),
            "council": result.get("council"),
            "verification": {
                "status": "failed" if paused else "unverified",
                "gate": "credit_pause" if paused else "none",
            },
            "vote_summary": (result.get("pause") or {}).get("headline") or vote.get("summary", ""),
            "vetoed": bool(vote.get("vetoed")),
            "paused": paused,
        },
    }
    if paused:
        bundle["paused"] = True
        bundle["pause"] = result.get("pause") or {}
        bundle["resume"] = result.get("resume") or {}
    return bundle


def persist_run(bundle: dict) -> Path:
    """Validate + write a run bundle immutably. Raises on schema error or re-write."""
    errs = validate_instance(bundle, _schema())
    if errs:
        raise ValueError("Run bundle failed schema: " + "; ".join(errs[:5]))

    RUNS_DIR.mkdir(exist_ok=True)
    path = RUNS_DIR / f"{bundle['run_id']}.json"
    if path.exists():
        raise FileExistsError(f"Run {bundle['run_id']} already persisted (immutable)")

    path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")

    index_row = {
        "run_id": bundle["run_id"],
        "created_at": bundle["created_at"],
        "task": bundle["task"],
        "mode": bundle["mode"],
        "roles": bundle["roles"],
        "costUsd": (bundle.get("usage") or {}).get("costUsd", 0.0),
        "vetoed": bundle["provenance"]["vetoed"],
        "paused": bool(bundle.get("paused") or bundle["provenance"].get("paused")),
        "verification": bundle["provenance"]["verification"]["status"],
    }
    with open(RUNS_DIR / "index.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(index_row, ensure_ascii=False) + "\n")

    return path


def load_run(run_id: str) -> dict | None:
    """Load a full run bundle. Returns None if missing; raises JSONDecodeError if corrupt."""
    path = RUNS_DIR / f"{run_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def list_runs() -> list[dict]:
    """Return metadata for each run_*.json (skips corrupt/partial files).

    Does not include trace/vote/final_text — list endpoint stays light.
    Missing or empty ``.runs/`` yields [].
    """
    if not RUNS_DIR.exists():
        return []
    out: list[dict] = []
    for path in sorted(RUNS_DIR.glob("run_*.json")):
        try:
            raw = path.read_text(encoding="utf-8")
            if not raw.strip():
                continue
            data = json.loads(raw)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            # AT-11: partial/corrupt files are skipped; valid runs still returned.
            continue
        if not isinstance(data, dict):
            continue
        usage = data.get("usage") or {}
        prov = data.get("provenance") or {}
        verification = prov.get("verification") or {}
        out.append(
            {
                "run_id": data.get("run_id") or path.stem,
                "created_at": data.get("created_at"),
                "task": data.get("task"),
                "mode": data.get("mode"),
                "roles": data.get("roles") or [],
                "question": data.get("question") or "",
                "costUsd": usage.get("costUsd", 0.0),
                "vetoed": bool(prov.get("vetoed")),
                "paused": bool(data.get("paused") or prov.get("paused")),
                "verification": verification.get("status"),
            }
        )
    return out


def persistence_enabled() -> bool:
    return os.environ.get("ORCHESTR8_PERSIST", "1") != "0"
