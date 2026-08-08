# ADR 0004 — Lift feature freeze and milestone gates

**Status:** Accepted  
**Date:** 2026-08-02  
**Owner:** Gregory Williamson / 258 Services  

## Decision

Feature freeze and Now/Next/Later **milestone refusal** are turned **OFF**.

- `AGENTS.md` rule 7 no longer blocks work outside an active milestone.
- `docs/backlog.md` is an inventory of **remaining work** and shipped history, not a gate.
- Orchestr8 Build Spec Critic must **not** veto solely for freeze/milestone order.

## Still in force

- AGENTS.md rules 1–6 (decisions, provenance, immutable raw, no fake precision, swappable adapters, agent contracts).
- ADR 0003 autonomy 0: Orchestr8 authors specs; Cursor builds (preferred for non-trivial features).

## Why

Freeze blocked useful work (e.g. Sources registry editor Build Spec veto
`run_20260802T205554_dfb45edb`) after Orchestr8 + Signals/Binder wiring matured.
Owner chose velocity over sequenced refusal.

## Consequences

- Remaining incomplete items are listed in detail under **Remaining work** in `docs/backlog.md`.
- Teams should still prefer Build Spec → Cursor and Critic on high-dollar / high-scope changes.
- ADR 0002 sequencing is historical guidance, not a hard gate.
