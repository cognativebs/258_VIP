"""Council voting — turns structured agent outputs into a gate decision.

Policies (from config/councils.yaml → council.voting):
  none              — informational only, no gate.
  veto_on_critical  — any 'reject' verdict or any 'critical' issue blocks the answer.
  dissent_required  — surface disagreement (differing verdicts / wide confidence spread).
  auto              — default when no council supplied: behave as veto_on_critical
                      only if a critical issue exists or a challenge-type agent
                      (critic/tester/domain_expert) returned a verdict; else none.
"""
from __future__ import annotations

from typing import Any

_DISSENT_SPREAD = 0.30  # confidence range that counts as material disagreement

# Agents whose verdict carries veto authority when no explicit council is set.
# A Researcher rejecting "analyze empty data" must not gate a whole answer.
_VETO_AGENTS = {"critic", "tester", "domain_expert", "red_team", "devils_advocate"}


def evaluate_votes(trace: list[dict], council_meta: dict | None = None) -> dict[str, Any]:
    policy = (council_meta or {}).get("voting") or "auto"

    # Who is allowed to veto: explicit council members, else the challenge set.
    if council_meta and council_meta.get("agents"):
        authorities = set(council_meta["agents"])
    else:
        authorities = set(_VETO_AGENTS)

    members: list[dict] = []
    for step in trace:
        s = step.get("structured") or {}
        issues = s.get("issues") if isinstance(s.get("issues"), list) else []
        critical = sum(1 for i in issues if isinstance(i, dict) and i.get("severity") == "critical")
        major = sum(1 for i in issues if isinstance(i, dict) and i.get("severity") == "major")
        conditions = s.get("conditions") if isinstance(s.get("conditions"), list) else []
        members.append(
            {
                "role": step.get("role"),
                "label": step.get("role_label"),
                "verdict": s.get("verdict"),
                "confidence": step.get("confidence"),
                "criticalIssues": critical,
                "majorIssues": major,
                "conditions": conditions,
                "authority": step.get("role") in authorities,
            }
        )

    verdicts = [m["verdict"] for m in members if m["verdict"]]
    authority_verdicts = [m["verdict"] for m in members if m["verdict"] and m["authority"]]
    total_critical = sum(m["criticalIssues"] for m in members)
    conditions = [c for m in members for c in m["conditions"] if isinstance(c, str)]

    effective = policy
    if policy == "auto":
        # Only gate when a real signal exists: a critical issue or an
        # authority-level verdict. Ignore lone non-authority rejects.
        effective = "veto_on_critical" if (total_critical > 0 or authority_verdicts) else "none"

    result: dict[str, Any] = {
        "policy": policy,
        "effectivePolicy": effective,
        "members": members,
        "verdict": _worst_verdict(verdicts) if verdicts else None,
        "vetoed": False,
        "dissent": False,
        "criticalIssues": total_critical,
        "conditions": conditions[:8],
        "summary": "",
    }

    if effective == "veto_on_critical":
        reject_by_authority = "reject" in authority_verdicts
        if total_critical > 0 or reject_by_authority:
            result["verdict"] = "reject"
            result["vetoed"] = True
        elif "conditional" in authority_verdicts:
            result["verdict"] = "conditional"
        result["summary"] = _summarize_veto(result, reject_by_authority)

    elif effective == "dissent_required":
        confs = [m["confidence"] for m in members if isinstance(m["confidence"], (int, float))]
        spread = round(max(confs) - min(confs), 2) if len(confs) >= 2 else 0.0
        distinct = {v for v in verdicts}
        result["confidenceSpread"] = spread
        result["dissent"] = len(distinct) > 1 or spread >= _DISSENT_SPREAD or "reject" in verdicts
        result["summary"] = _summarize_dissent(result, spread, distinct)

    return result


def _worst_verdict(verdicts: list[str]) -> str:
    if "reject" in verdicts:
        return "reject"
    if "conditional" in verdicts:
        return "conditional"
    return "approve"


def _summarize_veto(result: dict, reject_by_authority: bool) -> str:
    if result["vetoed"]:
        n = result["criticalIssues"]
        reasons = []
        if n:
            reasons.append(f"{n} critical issue{'s' if n != 1 else ''}")
        if reject_by_authority:
            reasons.append("a reject verdict from the challenge panel")
        detail = " and ".join(reasons) if reasons else "blocking findings"
        base = f"Challenge Council VETO — {detail} must be resolved before acting."
        if result["conditions"]:
            base += " Conditions: " + "; ".join(result["conditions"][:3])
        return base
    if result["verdict"] == "conditional":
        return "Challenge Council: conditional approval — address noted conditions."
    if result["verdict"] == "approve":
        return "Challenge Council: approved."
    return ""


def _summarize_dissent(result: dict, spread: float, distinct: set) -> str:
    if not result["dissent"]:
        return "Board: consensus reached."
    bits = []
    if len(distinct) > 1:
        bits.append("split verdicts (" + ", ".join(sorted(distinct)) + ")")
    if spread >= _DISSENT_SPREAD:
        bits.append(f"confidence spread {spread:.0%}")
    if "reject" in distinct:
        bits.append("at least one reject")
    return "Board DISSENT — " + "; ".join(bits) + "."


def apply_gate(text: str, vote: dict) -> str:
    """Prepend a machine-readable banner to the final answer when gated."""
    if vote.get("vetoed"):
        banner = "[VETO] " + (vote.get("summary") or "Critical issues must be resolved before acting.")
        return banner + "\n\n" + text
    if vote.get("dissent"):
        banner = "[DISSENT] " + (vote.get("summary") or "Members disagree; not a consensus recommendation.")
        return banner + "\n\n" + text
    return text
