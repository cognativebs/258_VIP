#!/usr/bin/env python3
"""Generate a build spec via the Build Spec Council (ADR 0003 · O1).

Usage:
    python scripts/generate_build_spec.py "O2 Diff review loop: paste diff → Challenge Council"
    python scripts/generate_build_spec.py --dry-run "…"   # gather context only, no LLM

Requires provider keys in orchestr8/.env for a live run. The offline gate is
demo_build_spec.py (no keys needed).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from services.orchestrator import run_job  # noqa: E402
from services.registry import get_council  # noqa: E402
from services.tools import gather_build_context  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Orchestr8 build-spec generator")
    parser.add_argument("question", nargs="+", help="Backlog item / goal to spec")
    parser.add_argument("--dry-run", action="store_true", help="Print repo context only")
    parser.add_argument("--quality", default="balanced", choices=("min", "balanced", "max"))
    args = parser.parse_args()
    question = " ".join(args.question).strip()

    if args.dry_run:
        text = gather_build_context("architect")
        try:
            print(text)
        except UnicodeEncodeError:
            sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
            sys.stdout.buffer.write(b"\n")
        return 0

    council = get_council("build_spec")
    if not council:
        print("ERROR: build_spec council missing from config/councils.yaml", file=sys.stderr)
        return 1

    roles = list(council["agents"])
    mode = council.get("mode") or "pipeline"
    context = json.dumps({"backlogItem": question, "adr": "0003"})

    print(f"Running Build Spec Council: {' → '.join(roles)} ({mode})")
    result = run_job(
        task="build_spec",
        roles=roles,
        mode=mode,
        question=question,
        context_json=context,
        council="build_spec",
    )

    print(f"\nrunId:           {result.get('runId')}")
    print(f"buildSpecStatus: {result.get('buildSpecStatus')}")
    print(f"buildSpecPath:   {result.get('buildSpecPath')}")
    print(f"vetoed:          {(result.get('vote') or {}).get('vetoed')}")
    cost = (result.get("usage") or {}).get("costUsd")
    if cost is not None:
        print(f"costUsd:         {cost}")

    if result.get("buildSpecStatus") == "vetoed":
        print("\nVETO — fix the gaps and re-run. Critic summary:")
        print((result.get("vote") or {}).get("summary") or result.get("text", "")[:500])
        return 2

    if not result.get("buildSpecPath"):
        print("\nWARN — no spec file written. Tail of committee text:")
        print((result.get("text") or "")[:800])
        return 1

    print(f"\nWrote {result['buildSpecPath']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
