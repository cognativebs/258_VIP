#!/usr/bin/env python3
"""Generate a contract.yaml for each agent from agent.yaml + role-aware defaults.

ADR 0002 · O0. Idempotent: skips agents that already have a contract unless
--force is passed. Emitted contracts are meant to be reviewed and hand-tuned;
this only removes the drudgery of the first 22.

    python scripts/scaffold_contracts.py [--force]
"""
from __future__ import annotations

import sys
from collections import OrderedDict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from services.registry import load_agents  # noqa: E402

# Autonomy target A (advisory): tools are declared here but stay read/propose-only
# until O1 implements them and O2 gates them.
COORDINATORS = {"orchestrator", "project_manager", "synthesizer"}
CHALLENGE = {"critic", "tester", "domain_expert"}
# Recommendations that move money → always earn a critic pass (AGENTS.md rule 6).
HIGH_IMPACT = {
    "investment_analyst",
    "pricing_agent",
    "sell_advisor",
    "portfolio_manager",
    "acquisition_scout",
    "prediction_engine",
    "grading_advisor",
}
# Meta / build-track agents that reason about systems, not the collection slice.
META = COORDINATORS | {"architect", "tester", "innovator"}
READ_TOOLS = {
    "architect": ["read_file", "list_dir", "grep", "git_diff"],
    "tester": ["read_file", "list_dir", "grep", "run_tests"],
    "critic": ["read_file", "git_diff"],
}


def _represent_ordered(dumper, data):
    return dumper.represent_mapping("tag:yaml.org,2002:map", data.items())


yaml.add_representer(OrderedDict, _represent_ordered)


def build_contract(agent_id: str, meta: dict) -> OrderedDict:
    high_impact = agent_id in HIGH_IMPACT
    is_challenge = agent_id in CHALLENGE

    required_fields = ["summary", "confidence"]
    if is_challenge:
        required_fields.append("verdict")

    when = ["low_confidence", "tool_error"]
    if high_impact:
        when.insert(1, "high_impact")

    contract = OrderedDict()
    contract["id"] = agent_id
    contract["version"] = 1
    contract["mission"] = meta.get("description") or f"{meta.get('label', agent_id)} agent for the Orchestr8 team."
    contract["inputs"] = OrderedDict(
        task_types=["*"],
        requires_context=agent_id not in META,
    )
    contract["allowed_tools"] = READ_TOOLS.get(agent_id, [])
    contract["outputs"] = OrderedDict(
        schema=meta.get("output_schema", "standard_agent_v1"),
        required_fields=required_fields,
    )
    contract["confidence"] = OrderedDict(
        required=True,
        min=0.0,
        max=1.0,
        escalate_below=0.6 if high_impact else 0.5,
    )
    contract["failure_behavior"] = "escalate" if agent_id in COORDINATORS else "degrade"
    contract["escalation"] = OrderedDict(
        to=["human"] if is_challenge else ["critic"],
        when=when,
    )
    contract["high_impact"] = high_impact
    contract["enabled"] = meta.get("enabled", True)
    return contract


def main() -> int:
    force = "--force" in sys.argv
    agents = load_agents()
    if not agents:
        print("No agents found.")
        return 1

    written, skipped = 0, 0
    for agent_id, meta in agents.items():
        path = ROOT / "agents" / agent_id / "contract.yaml"
        if path.exists() and not force:
            skipped += 1
            continue
        contract = build_contract(agent_id, meta)
        header = (
            f"# Orchestr8 contract — {meta.get('label', agent_id)}\n"
            "# Schema: config/contract.schema.json  (ADR 0002 · O0)\n"
            "# Autonomy A: tools are read/propose-only until O1/O2.\n"
        )
        body = yaml.dump(contract, default_flow_style=False, sort_keys=False)
        path.write_text(header + body, encoding="utf-8")
        written += 1
        print(f"  wrote {path.relative_to(ROOT)}")

    print(f"\nContracts: {written} written, {skipped} skipped ({len(agents)} agents).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
