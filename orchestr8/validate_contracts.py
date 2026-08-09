#!/usr/bin/env python3
"""O0 contract gate — every enabled agent must have a valid contract.

    python validate_contracts.py

Exit 0 when all enabled agents have a schema-valid contract whose id matches the
agent and whose escalation targets resolve to real agents. Exit 1 otherwise.
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from services.contracts import list_contracts, load_contract, validate_contract  # noqa: E402
from services.registry import load_agents  # noqa: E402


def main() -> int:
    agents = load_agents()
    contracts = list_contracts()
    known_agents = set(agents)

    failures: list[str] = []
    ok = 0

    for agent_id, meta in sorted(agents.items()):
        if meta.get("enabled") is False:
            continue
        contract = load_contract(agent_id)
        if contract is None:
            failures.append(f"{agent_id}: no contract.yaml")
            continue

        errs = validate_contract(contract)
        if contract.get("id") != agent_id:
            errs.append(f"id mismatch: contract says {contract.get('id')!r}")
        for target in (contract.get("escalation") or {}).get("to", []):
            if target not in known_agents and target != "human":
                errs.append(f"escalation target {target!r} is not a known agent")

        if errs:
            for e in errs:
                failures.append(f"{agent_id}: {e}")
        else:
            ok += 1
            tools = contract.get("allowed_tools") or []
            flag = " [high-impact]" if contract.get("high_impact") else ""
            print(f"  OK  {agent_id}{flag}  tools={tools or '-'}")

    orphans = set(contracts) - known_agents
    for orphan in sorted(orphans):
        failures.append(f"{orphan}: contract has no matching agent")

    print()
    if failures:
        print(f"FAIL — {len(failures)} problem(s):")
        for f in failures:
            print(f"  - {f}")
        return 1

    print(f"PASS - {ok} agents, all contracts valid against config/contract.schema.json.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
