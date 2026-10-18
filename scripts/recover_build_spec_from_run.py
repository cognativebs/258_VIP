"""Recover build_spec from a run when fence extraction failed."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "orchestr8"))

from services.build_spec import (  # noqa: E402
    attach_provenance,
    extract_build_spec,
    write_spec,
)


def main() -> None:
    run_id = sys.argv[1] if len(sys.argv) > 1 else "run_20260802T213309_f965cb9a"
    path = ROOT / "orchestr8" / ".runs" / f"{run_id}.json"
    d = json.loads(path.read_text(encoding="utf-8"))
    result = {
        "text": d.get("final_text") or "",
        "trace": d.get("trace") or [],
        "vote": {"vetoed": False, "verdict": "conditional"},
        "roles": d.get("roles") or [],
        "council": "build_spec",
        "runId": d.get("run_id"),
    }
    # Prefer walking architect first via improved extract
    spec = None
    for step in result["trace"]:
        if step.get("role") == "architect":
            spec = extract_build_spec(step.get("text") or "")
            if spec:
                break
    if not spec:
        for step in reversed(result["trace"]):
            spec = extract_build_spec(step.get("text") or "")
            if spec:
                break
    if not spec:
        raise SystemExit("Still could not extract build_spec JSON")

    stamped = attach_provenance(
        spec,
        run_id=result["runId"],
        council="build_spec",
        roles=result["roles"],
        vote=result["vote"],
        confidence=0.9,
        trace=result["trace"],
    )
    # Note conditional critic approval in provenance notes
    stamped["provenance"]["notes"] = (
        "Recovered after emit_failed (nested fences in cursor_prompt). "
        "Critic verdict was conditional — address conditions before/while implementing."
    )
    out = write_spec(stamped)
    print("Wrote", out)
    print("id", stamped["id"])
    print("title", stamped.get("title"))


if __name__ == "__main__":
    main()
