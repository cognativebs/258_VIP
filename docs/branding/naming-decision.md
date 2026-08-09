# Naming decision — public brand trio

**Status:** Decided (names), pending legal clearance  
**Date:** 2026-08-08  
**Owner:** Gregory Williamson  
**Theme:** Craft / Transformation / Value Creation  
**Source:** [`conversation-export-2026-08-04.md`](conversation-export-2026-08-04.md)

## Decision

The public product family drops the “Vault” theme entirely and ships under three
Craft names:

> **Crucible · Forge · Temper**

Rejected from the shortlist (kept as reserve): Alloy, Anvil, Catalyst, Assay,
Ingot, Billet, Quench, Anneal.

## Why these three

Crucible and Forge both describe *where work happens*, so the third name
deliberately does a different job: **Temper** is the act of making something
tough rather than brittle — judgment and restraint, which is what a decision
platform actually sells.

## Surface assignment

| Public name | Replaces (internal) | Owns |
| --- | --- | --- |
| **Crucible** | Vault Intelligence Platform (VIP) + IQVault | Parent platform and the collector face you log into — where a collection gets tested |
| **Forge** | Binder Vault | Building and arranging collections: binders, pages, pockets, hunts |
| **Temper** | decision-engine + pricing / valuation surface | Judgment layer: market marks, ranges, confidence, Buy/Hold/Grade/Sell/Lot/Pass |

### Still unnamed (open)

- **VaultOS** — LGS / store face. Needs its own public name or becomes
  “Crucible for Stores.”
- **Orchestr8** — agent layer. May stay internal infrastructure (never
  user-facing), in which case it needs no public name.

## Constraints carried forward

1. Internal names (VIP, IQVault, Binder Vault, VaultOS, Orchestr8) stay in code,
   docs, and dev tooling until a rename PR lands. No half-renamed state.
2. `AGENTS.md` protected terms are unaffected — `asset`, `holding`,
   `priced_unit`, `sale`, `market_value`, `collection_hunt`, `external_id`,
   `assumed_grade` are data vocabulary, not brand.
3. Trademark/domain clearance is **not** done. Per the branding conversation,
   the “Vault” names were abandoned precisely because clearance failed, so these
   three need the same check before any public use.

## Next steps

1. Clearance pass (USPTO + domains) on Crucible, Forge, Temper.
2. Decide the store-face name.
3. Apply [`apps/binder-vault/TOOL_THEME_MAP.md`](../../apps/binder-vault/TOOL_THEME_MAP.md)
   in a dedicated rename PR — product names first, then UI labels.
