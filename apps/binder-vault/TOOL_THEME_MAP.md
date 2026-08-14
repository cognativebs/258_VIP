# Binder Vault → Forge — tool name map

**Status:** names decided; **UI not renamed yet.**  
**Date:** 2026-08-08 (supersedes the 2026-08-05 guess draft)  
**Scope:** user-facing Binder Vault tool / button labels.  
**Decision record:** [`docs/branding/naming-decision.md`](../../docs/branding/naming-decision.md)

## Locked names

> **Crucible** — parent platform + collector face (was VIP + IQVault)  
> **Forge** — this app: building and arranging collections (was Binder Vault)  
> **Temper** — valuation / judgment layer: market marks, ranges, confidence

Reserve words (not assigned): Alloy, Anvil, Catalyst, Assay, Ingot, Billet, Quench, Anneal.

## Guiding rule for labels

**Theme the products, not every button.** Three brand names plus a couple of
genuine verbs is a voice; renaming twelve buttons is a thesaurus the user has to
learn. So:

- **Keep literal** anything structural or navigational — Binder, Page, Pocket,
  Prev/Next, Print, Delete. These are physical objects the collector already
  knows.
- **Use Craft vocabulary** only where it carries real meaning: the product names
  themselves, and price/valuation actions (which belong to **Temper**).
- **Never** theme a destructive action into something ambiguous. "Quench Page"
  reads as a feature; "Delete Page" reads as a consequence.

Earlier draft labels like *Add Plate*, *Quench Page*, *Stock*, *Seek*, and
*Share Crucible* are **dropped** for that reason — they were stretches, and
`Share Crucible` is now wrong outright since Crucible is the platform, not a binder.

---

## Topbar / binder tools

| Current label | New label | Rationale |
| --- | --- | --- |
| Copy URL | Copy link | Literal beats themed for a utility action |
| + New Binder | + New Binder | Keep — "Forge Binder" is redundant inside an app named Forge |
| + Create your first binder | Create your first binder | Empty-state CTA stays plain |
| Cards | Cards | Short and clear, especially on mobile |
| Search | Search | Same |
| ‹ Prev / Next › | ‹ Prev / Next › | Pagination clarity > theme |
| + Add Page | + Add Page | Literal |
| Delete Page | Delete Page | Destructive actions stay unambiguous |
| Move / Copy Page | Move / Copy Page | Literal |
| **Sync Prices** | **Temper Prices** | Fill missing market marks — this *is* the Temper action, so the name does double duty as branding |
| Syncing… | Tempering… | Busy state for the above |
| **Refresh All** | **Re-Temper All** | Force re-observe every priced card on the page |
| **Sync Owned (VIP)** | **Sync Owned (Crucible)** | Same action; platform renamed |
| Highlight Missing | Highlight Missing | Already plain and accurate |
| Export Wishlist | Export Wishlist | Literal; it produces a store list |
| Print Page | Print Page | Literal |
| Delete Binder | Delete Binder | Destructive stays literal |

## Shelf / page chrome

| Current | New | Rationale |
| --- | --- | --- |
| Binder Vault (brand) | **Forge** | Product rename |
| Your collection, shelved | *(needs new line)* | Tagline should carry the Craft voice — draft: “Where a collection gets made.” Owner call. |
| Spine strip | Shelf | Already the mental model |
| Page tabs | Pages | Literal |
| Center = Chase #1 | Center = Chase #1 | Keep — real TCG vocabulary |

## Ledger (value rail)

The rail is the **Temper** surface inside Forge, so this is where themed
language earns its place.

| Current | New | Rationale |
| --- | --- | --- |
| Ledger | Temper | The valuation read for this page/binder |
| Page / Binder (scope) | Page / Binder | Literal |
| Total market | Marked value | "Marked" signals observed, not guaranteed |
| Owned | Owned | Literal |
| Still need | Still need | Literal |
| Delta | Delta | Understood by the audience |
| **Prices as of …** | **Tempered as of …** | Freshness of the last successful observation |
| Select all / All in scope | Select all / All in scope | Literal |

## Pocket actions

| Current | New | Rationale |
| --- | --- | --- |
| Owned toggle | Owned | Literal |
| Wishlist / ★ | Wishlist / ★ | Literal |
| View / zoom | View | Literal |
| Remove / clear | Clear pocket | Explicit about scope |
| Drag rearrange | Drag to rearrange | Literal |

## Search dock / filters

Unchanged. Vendor names (`TCG.io`, `TCGdex`) and TCG rarity terms (Holo, SIR,
ACE SPEC) are domain truth and must not be themed.

---

## Rename sequence (when the PR happens)

1. Clear trademarks/domains first — the Vault names died at this step.
2. Rename the **products** (Binder Vault → Forge, VIP/IQVault → Crucible) across
   `package.json` names, nav brand, docs, and start scripts.
3. Then apply the **Temper** label changes above (prices + ledger).
4. Leave literal labels alone.

## Out of scope

- Orchestr8 agent / `allowed_tools` names (internal infrastructure)
- `AGENTS.md` data vocabulary: `asset`, `holding`, `priced_unit`, `sale`,
  `market_value`, `collection_hunt`, `external_id`, `assumed_grade`
- VIP decision verbs (Buy / Hold / Grade / Sell / Lot / Pass) — these stay
  literal; they're the product's promise, not its branding
