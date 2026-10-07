# Orchestr8 naming — leftover Orchastr8 spellings

Status: log only (2026-09-22). Not a rename.
Related: ADR 0013 gate G-3.

New identifiers use **Orchestr8**. The directory `orchestr8/` already uses that spelling. The strings below still say **Orchastr8**. They were not changed in the spine pass.

| Location | What it says |
| --- | --- |
| `docs/adr/0001-product-boundaries.md` | Title and body use Orchastr8 for the agent layer (lines 1, 12, 19, 26, 36, 51, 81, 86, 92). |
| `docs/entities-v0.1.md` | Tool name and the Signal Hunter vocabulary lock (lines 15, 74, 85). |
| `packages/core-model/src/signals.ts` | Comment on line 27: "not the Orchastr8 Signal Hunter agent role." |
| `signals/2026-09-20_signals-v1-spine.iqvplan.json` | Gate G-3 names the old spelling so the cleanup can find it. |

A later pass can rename these. Do not mix that rename into a signals migration.
