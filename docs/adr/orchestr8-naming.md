# Orchestr8 naming — Orchastr8 was a typo

Status: done (2026-09-24). Related: ADR 0013 gate G-3.

**Orchestr8** is the only spelling. "Orchastr8" was a typo. The directory `orchestr8/` already used the right spelling.

Renamed on 2026-09-24:

| Location | Change |
| --- | --- |
| `docs/adr/0001-product-boundaries.md` | Title and body. |
| `docs/entities-v0.1.md` | Tool name and the Signal Hunter vocabulary lock. |
| `packages/core-model/src/signals.ts` | Doc comment. |
| `packages/core-model/src/identity.ts` | `ToolCodeSchema` value `"orchastr8"` → `"orchestr8"`. Nothing consumed the enum and no table stores it, so no data migration was needed. |

Left as written: `signals/2026-09-20_signals-v1-spine.iqvplan.json` and `signals/2026-09-22_SIGNALS_V1_SPINE_REPORT.md`. They are dated records of the plan and the build, and they quote the old spelling on purpose.

New code and docs use Orchestr8. Do not reintroduce the typo.
