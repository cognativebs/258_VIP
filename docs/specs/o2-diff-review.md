# Build Spec — O2 Diff review loop

**ID:** `o2-diff-review`  
**Verification:** critic_passed  
**Council:** build_spec  
**Run:** `run_demo_o1`  
**Generated:** 2026-07-27 02:40 UTC

> Orchestr8 authors this spec (ADR 0003). Execute it in Cursor. After implementation, paste the diff back to the Challenge Council for review.

## Goal

After Cursor implements a build spec, paste the diff back so the Challenge Council (critic + tester + domain_expert) scores it against the spec's acceptance criteria and returns approve/conditional/reject.

## Constraints

- Autonomy 0 — Orchestr8 never writes or executes code (ADR 0003)
- Feature freeze — only O2 scope; do not resume VIP Phases 5–6
- Reuse existing Challenge Council voting (veto_on_critical)
- Provenance on the review artifact (source, method, confidence, verification)

## Contracts / schemas first (DoD)

- `orchestr8/config/diff_review.schema.json` — Define input (spec_id, diff_text) and output (verdict, findings, provenance)
- `orchestr8/services/diff_review.py` — Loader + validator + markdown renderer for review results

## File plan

| Path | Action | Notes |
|---|---|---|
| `orchestr8/config/diff_review.schema.json` | create | JSON Schema for the review bundle |
| `orchestr8/services/diff_review.py` | create | Extract/validate/emit review; load paired docs/specs/<id>.json |
| `orchestr8/scripts/review_diff.py` | create | CLI: --spec-id + diff file → Challenge Council job |
| `orchestr8/demo_diff_review.py` | create | Offline gate: council catches a deliberately violating diff |
| `docs/backlog.md` | modify | Check off O2 items when gate passes |

## Acceptance tests

1. Offline demo: a diff that omits a required acceptance test is rejected/vetoed
2. A conforming synthetic diff receives approve or conditional with findings list
3. Review artifact written under docs/specs/ or .runs/ with provenance
4. python demo_diff_review.py exits 0

## Risks

- Large diffs may truncate; need size limits and clear truncation flags
- Critic may over-veto style nits — keep policy on acceptance criteria only

## Out of scope

- Auto-applying fixes in the repo
- Terminal UI / VIP Phase 5–6 work

## Cursor prompt (paste as-is)

```
Implement Orchestr8 Phase O2 (ADR 0003): Diff review loop.

Goal: paste an implemented diff + build-spec id into Orchestr8; run the Challenge Council against the spec's acceptance_tests; emit a review artifact with provenance.

Constraints: Autonomy 0 (no write/execute tools); reuse challenge council voting; feature freeze.

Do schemas first: orchestr8/config/diff_review.schema.json, then services/diff_review.py, scripts/review_diff.py, demo_diff_review.py.

Acceptance: offline demo catches a deliberately violating diff; conforming diff gets approve/conditional; provenance populated.
```

## Provenance

- source: orchestr8.build_spec_council
- method: multi_agent_pipeline
- rule/model version: build_spec_v1
- confidence: 0.74
- verification: critic_passed
- roles: architect, domain_expert, tester, critic
