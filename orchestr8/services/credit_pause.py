"""Credit/billing pause — stop the council until the operator tops up and resumes.

Successful steps stay in the run bundle. Resume retries only the failed role,
then remaining roles. The pipeline never walks around a credit failure.
"""
from __future__ import annotations

from typing import Any

# Specific billing phrases. "credit" alone is too broad (accreditation, etc.).
CREDIT_NEEDLES = (
    "insufficient_quota",
    "insufficient quota",
    "insufficient_funds",
    "insufficient funds",
    "insufficient credit",
    "insufficient credits",
    "credit balance",
    "credits exhausted",
    "out of credits",
    "out of credit",
    "billing_not_active",
    "billing not active",
    "billing hard limit",
    "exceeded your current quota",
    "quota exceeded",
    "spend limit",
    "payment required",
    "prepaid balance",
    "account has no credits",
    "please add credits",
    "add credits",
    "top up",
    "error code: 402",
    "status code 402",
    "http 402",
    "402 payment",
)

TOPUP_URLS = {
    "openai": "https://platform.openai.com/settings/organization/billing",
    "anthropic": "https://console.anthropic.com/settings/billing",
    "grok": "https://console.x.ai/",
    "xai": "https://console.x.ai/",
}


def is_credit_error(exc_or_text: Any) -> bool:
    msg = str(exc_or_text or "").lower()
    if not msg:
        return False
    if "402" in msg and any(n in msg for n in ("credit", "billing", "quota", "payment", "fund")):
        return True
    return any(needle in msg for needle in CREDIT_NEEDLES)


def step_is_credit_pause(step: dict | None) -> bool:
    if not isinstance(step, dict):
        return False
    if step.get("pause") == "credit":
        return True
    return bool(step.get("error") and is_credit_error(step.get("error")))


def seed_trace(trace: list[dict]) -> list[dict]:
    """Successful steps only — these must not be re-called on resume."""
    return [s for s in trace if isinstance(s, dict) and not s.get("error")]


def topup_url(provider: str | None) -> str:
    return TOPUP_URLS.get((provider or "").lower(), "")


def build_pause(
    step: dict,
    *,
    seed: list[dict],
    remaining_roles: list[str],
    spent_usd: float = 0.0,
) -> dict[str, Any]:
    provider = str(step.get("provider") or "")
    role = str(step.get("role") or "unknown")
    label = str(step.get("role_label") or role)
    detail = str(step.get("error") or step.get("text") or "provider rejected the call")
    completed = [str(s.get("role_label") or s.get("role") or "") for s in seed if s.get("role")]
    remaining = remaining_roles[:] if remaining_roles else [role]
    if remaining[0] != role:
        remaining = [role] + [r for r in remaining if r != role]
    url = topup_url(provider)
    headline = (
        f"PAUSED — {label} hit a credit/billing limit on "
        f"{step.get('provider_label') or provider or 'the provider'} "
        f"({step.get('model_label') or step.get('model') or 'model'})."
    )
    instruction = (
        f"Top up {step.get('provider_label') or provider or 'that provider'}"
        + (f" ({url})" if url else "")
        + ", then click Resume. Completed roles will not be re-called. "
        "The failed role retries first; the council stays paused until you resume."
    )
    return {
        "reason": "credit",
        "role": role,
        "role_label": label,
        "provider": provider,
        "provider_label": str(step.get("provider_label") or provider),
        "model": str(step.get("model") or ""),
        "model_label": str(step.get("model_label") or step.get("model") or ""),
        "detail": detail,
        "headline": headline,
        "topup_url": url,
        "completed_roles": completed,
        "remaining_roles": remaining,
        "spent_usd": round(float(spent_usd or 0.0), 6),
        "instruction": instruction,
    }


def build_resume_payload(
    *,
    task: str,
    mode: str,
    roles: list[str],
    question: str,
    context_json: str,
    council: str | None,
    model_overrides: dict,
    seed: list[dict],
    failed_role: str,
    failed_phase: str,
    prior_run_id: str | None = None,
) -> dict[str, Any]:
    return {
        "task": task,
        "mode": mode,
        "roles": list(roles),
        "question": question,
        "context_json": context_json or "{}",
        "council": council,
        "model_overrides": dict(model_overrides or {}),
        "seed_trace": seed,
        "failed_role": failed_role,
        "failed_phase": failed_phase,
        "prior_run_id": prior_run_id,
    }


def load_resume_from_bundle(bundle: dict) -> dict:
    resume = bundle.get("resume")
    if not bundle.get("paused") or not isinstance(resume, dict):
        raise ValueError("That run is not paused for a credit top-off — start a new council.")
    if not resume.get("failed_role"):
        raise ValueError("Paused run is missing failed_role — cannot resume safely.")
    return resume
