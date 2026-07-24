# ADR 0003 — Orchestr8 Authors Specs; Cursor Builds

**Status:** Accepted  
**Date:** 2026-07-23  
**Owner:** Gregory Williamson / 258 Services  
**Supersedes:** the autonomy model (A/B/C) and the O1–O4 build-harness in ADR 0002

## Context

ADR 0002 sequenced an Orchestr8 track (O1–O4) that would give agents a tool
layer, a scratch-worktree sandbox, and a verification gate so Orchestr8 could
write and test code. On review, that is **re-implementing what Cursor already
is** — a mature agentic coding environment with tools, a sandbox, diff review,
and a model picker — inside a stdlib Python gateway. It duplicates the least
differentiated part of the stack and would be worse at it.

Orchestr8's actual value is the **brain**: 22 role-specialized agents across
three providers, council voting/veto, cost-aware synthesis, and provenance.
Cursor has none of that reasoning structure; Orchestr8 has none of Cursor's
build machinery.

## Decision

**Orchestr8 authors build specifications; Cursor (human-driven) builds them.**
Autonomy level is **0**: Orchestr8 never writes to the repo and never executes
code. It produces a critic-passed "work order" that a human executes in Cursor,
choosing the execution model there.

### Division of labor

| | Role |
|---|---|
| **Orchestr8** | Committee/architect. Debates, produces a build spec, critic veto, provenance. Read-only repo access. |
| **Cursor** | Builder. Consumes the spec, edits files, runs tests, iterates, presents diffs for review. |

### Round-trip review (the one tradeoff, mitigated)

The committee reviews the **spec**, not the implemented diff. To close that gap,
after Cursor implements, the diff is pasted back and the **Challenge Council**
(critic + tester + domain_expert) scores it against the spec's acceptance
criteria. Advisory; run it for high-impact changes, skip it for trivial ones.

### Consequences for contracts (applied at contract version 2)

- `allowed_tools` is **read-only only**: `read_file`, `list_dir`, `grep`,
  `git_diff`. Mutating/executing tools (`propose_patch`, `run_tests`,
  `run_shell`) are removed from the grantable enum entirely.
- Repo-reasoning agents (coordinators + architect/tester/critic/domain_expert)
  get read-only tools so specs reference real paths and existing contracts.
  Collection-analysis agents get none (they work from the context JSON).
- Coordinators and high-impact agents `escalate` on failure (never silently
  `degrade` — protects rule 4, no fake precision).
- Coordinators and challenge agents escalate to `human`; workers to `critic`.
- The money-risk critic-pass model (rule 6) is unchanged: 7 high-impact agents.

### Revised Orchestr8 track (replaces O1–O4)

| Phase | Name | Builds | Gate |
|---|---|---|---|
| **O1** | Build-spec generator | Work-order schema (goal, constraints, contracts/schemas-first, file plan, acceptance tests, risks, provenance, ready-to-paste Cursor prompt); a `build_spec` council task (architect → domain_expert → tester-as-test-designer → critic veto); emits a persisted run bundle **and** `docs/specs/*.md` | Committee produces a critic-passed spec for a real backlog item; spec persisted + written to `docs/specs/` |
| **O2** | Diff review loop | Paste implemented diff → Challenge Council scores it against the spec's acceptance criteria | Council catches a deliberately spec-violating diff |

After O2, VIP resumes — each item specced by Orchestr8, built in Cursor.

## Dropped / Parked

- In-Orchestr8 tool sandbox, write/execute tools, verification harness — Cursor owns building.
- Semi-autonomous and fully autonomous Orchestr8 build modes remain **Parked**.

## Related

- ADR 0002 — Orchestr8-First Build Sequence (autonomy model superseded here)
- `docs/backlog.md`
- `orchestr8/config/contract.schema.json`, `orchestr8/agents/*/contract.yaml`
- `AGENTS.md` (rules 2, 3, 4, 6)
