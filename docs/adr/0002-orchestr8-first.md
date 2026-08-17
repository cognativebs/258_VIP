# ADR 0002 — Orchestr8-First Build Sequence

**Status:** Accepted historically; **milestone freeze superseded 2026-08-02** (see ADR 0004)  
**Date:** 2026-07-23  
**Owner:** Gregory Williamson / 258 Services  
**Phase:** Re-sequencing (supersedes the former root `vip-cursor-build-kit.md`, removed)

> **Update 2026-07-23 — see ADR 0003.** The Orchestr8-first *sequencing* below
> still holds as guidance, but the **autonomy model (A/B/C)** and the **O1–O4 build-harness**
> are superseded: Orchestr8 will **author build specs**, and **Cursor builds them**
> (autonomy 0 — Orchestr8 never writes or executes).
>
> **Update 2026-08-02 — see ADR 0004.** Feature freeze / Now-only gates are **OFF**.
> Remaining work is inventoried in `docs/backlog.md` without milestone refusal.

## Context

VIP Phases 0–4 shipped: canonical model, evidence/provenance, immutable ingest,
decision engine, IQVault face, signals + zero-touch jobs. The next items were
Phase 5 (mobile) and Phase 6 (VaultOS), plus a Bloomberg-terminal UI restyle with
Orchestr8 team controls.

Orchestr8 already exists and is more complete than the backlog implied:

- **Gateway** (`orchestr8/api/server.py`): `/v1/health`, `/v1/agents`, `/v1/models`,
  `/v1/councils`, `/v1/plan`, `/v1/jobs`, `/v1/jobs/stream` (SSE), `/v1/reload`.
- **22 agents** (`agent.yaml` + skill files), **6 councils**, pipeline order, legacy aliases.
- **Orchestrator** (`services/orchestrator.py`): single / pipeline / parallel modes,
  coordinator + synthesis, cost aggregation, structured-JSON extraction, voting/veto gate.
- **Providers** (OpenAI / Anthropic / Grok), billing/cost readout, planner.

**The gap:** agents can only *talk*, not *build*. Every agent runs through
`chat_role()` — chat in, prose + JSON out. There is no tool use, no repo access,
no code execution, no run persistence, and no verification gate that actually
compiles or tests generated code. The "critic" is advisory only.

## Decision

**Complete Orchestr8 as a build engine before resuming VIP feature work.** Insert an
Orchestr8 track (O0–O4) ahead of VIP Phases 5–6 and the terminal UI. After O4, the
remaining VIP work is built *through* Orchestr8 (human-reviewed).

### Autonomy target: **(A) Advisory → human applies**

Orchestr8 produces specs and diffs; a human reviews and applies them in Cursor.
This is the starting posture — safest, no write-access risk, fastest to reach.
Semi-autonomous (scratch worktree + PR) and fully autonomous modes are **Parked**
until A is proven and O2's verification gate is trusted.

Consequences of choosing A:

- Tools in O1 are **read + propose**, not **write + commit**. `write_file` /
  `run_shell` produce *proposed* artifacts in a run bundle, never mutate the repo.
- The verification gate (O2) runs proposed diffs in a scratch worktree for
  evidence, but application to the real tree is a human action.
- No autonomous git commits. Orchestr8 output is a reviewable artifact.

### Orchestr8 track

| Phase | Name | Builds | Gate (done = provable) |
|---|---|---|---|
| **O0** | Contracts & persistence | Per-agent contract schema (mission, allowed_tools, IO schema, confidence rules, failure behavior, escalation) per AGENTS.md rule 6; run/artifact persistence schema (immutable per rule 3) | Every agent has a validated contract; one job persisted with full trace + cost |
| **O1** | Tool layer (read + propose) | Allow-listed tools: `read_file`, `list_dir`, `git_diff`, `grep`; propose-only `write_file`/`patch` that emit artifacts, never mutate; per-agent `allowed_tools` enforcement | Architect agent reads real files and emits a proposed patch artifact with provenance |
| **O2** | Verification gate | Proposed diffs applied to a throwaway scratch worktree; `tsc` + tests run; critic receives **real** pass/fail | A deliberately broken proposed change is caught and rejected by the gate |
| **O3** | Build workflow | "Build spec" contract → plan → implement → verify → critic → diff bundle; run persistence + artifact store; cost/critic gate on high-impact specs | Orchestr8 produces one merge-ready diff bundle for a trivial VIP task, end to end |
| **O4** | Self-hosting (advisory) | Orchestr8 authors a real backlog item as a diff bundle; human applies | A VIP change ships that Orchestr8 authored and a human reviewed + applied |

After O4, VIP resumes with the same gates as before, built via Orchestr8:
terminal UI + Orchestr8 team controls, Phase 5 mobile, Phase 6 VaultOS.

## Guardrails (unchanged AGENTS.md rules)

- **Rule 6 — contracts:** O0 formalizes mission / allowed_tools / IO schema /
  confidence / failure / escalation for every agent. High-impact specs get a critic pass.
- **Rule 2 — provenance:** every generated artifact carries source (which agents/models),
  method, model/rule version, confidence, verification status (gate pass/fail).
- **Rule 3 — immutable runs:** run bundles and proposed diffs are immutable snapshots;
  processed views regenerate from them.
- **Rule 5 — swappable:** tool adapters are contracts; no core logic depends on one tool impl.

## Consequences

- VIP Phases 5–6 and the terminal UI restyle move to **Later**, built via Orchestr8 after O4.
- The earlier "all roles on all models" UI request becomes a **consumer of O1's model/tool
  layer**, slotting in after O2 rather than being built standalone now.
- ~~Feature freeze holds…~~ **Superseded by ADR 0004** — freeze/milestone gates OFF (2026-08-02).

## Related

- ADR 0001 — Product Boundaries
- `docs/backlog.md`
- `AGENTS.md` (rules 2, 3, 5, 6)
- `orchestr8/api/server.py`, `orchestr8/services/orchestrator.py`
