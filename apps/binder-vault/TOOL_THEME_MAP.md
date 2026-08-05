# Binder Vault — tool name → Craft theme map (draft)

**Status:** mapping only — **do not rename UI yet.**  
**Date:** 2026-08-05  
**Scope:** user-facing Binder Vault tool / button labels (internal app).  
**Source theme:** Craft / Transformation / Value Creation  
*(from branding conversation — see `docs/branding/conversation-export-2026-08-04.md`)*

## Theme basis

Public “Vault” names are **internal-only** going forward. Destination labels below use the
locked Craft seed / shortlist:

> **Crucible · Forge · Temper · Alloy · Anvil · Catalyst**  
> *(also considered: Alchemy, Refinery, Origin)*

Metaphor guide for UI verbs:

| Craft word | Use for |
| --- | --- |
| Forge | Create / build / open something new |
| Crucible | The working surface / active binder or page under heat |
| Anvil | Stable workspace / where work is struck |
| Temper | Refine / refresh / harden quality (prices, owned state) |
| Alloy | Merge / combine / sync across systems |
| Catalyst | Kick off a process (export, print, hunt mode) |
| Assay *(derived)* | Read / inspect value without claiming precision |
| Quench *(derived)* | Stop / clear / retire |

Confidence: **High** = natural fit. **Med** = workable. **Low** = stretch; revisit after top-3 product name pick.

---

## Topbar / binder tools

| Current (internal) label | Craft-themed label (guess) | Why | Confidence | Later notes |
| --- | --- | --- | --- | --- |
| Copy URL | Share Crucible | Share the live work surface (LAN) | Med | Keep “Copy link” in tooltip |
| + New Binder | + Forge Binder | Create a new working book | High | Product may rename “Binder” later |
| + Create your first binder | Forge your first binder | Empty-state CTA | High | |
| Cards | Stock | Mobile search dock — raw material | Low | Or keep *Cards* for clarity |
| Search | Seek | Find stock to seat | Med | Vendor tabs stay as-is |
| Close | Close | Neutral | High | |
| ‹ Prev / Next › | ‹ Prev / Next › | Keep — pagination clarity > theme | High | |
| + Add Page | + Add Plate | Another plate in the crucible | Med | Alt: *+ Add Leaf* if book metaphor stays |
| Delete Page | Quench Page | Pull a plate from heat | Low | Soften to *Remove Page* if needed |
| Move / Copy Page | Transfer Plate | Move/copy between binders | Med | Split: *Move Plate* / *Alloy Copy* |
| Sync Prices | Temper Prices | Harden/fill market marks | High | Fill-missing only |
| Syncing… | Tempering… | Busy state | High | |
| Refresh All | Re-Temper All | Force re-assay prices on page | High | |
| Sync Owned (VIP) | Alloy Owned | Fuse VIP inventory ownership in | High | Tooltip: match internal VIP ids |
| Highlight Missing | Reveal Gaps | Show what’s still unforged / needed | High | On: *Reveal Gaps: On* |
| Export Wishlist | Cast Wishlist | Pour wants into a takeaway (PDF) | Med | Alt: *Catalyst: Wishlist* |
| Print Page | Press Plate | Physical impression | Med | |
| Delete Binder | Retire Binder | Take binder off the line | Med | Keep danger styling |

---

## Shelf / spine / page chrome

| Current label | Craft-themed label (guess) | Why | Confidence | Later notes |
| --- | --- | --- | --- | --- |
| Binder Vault (brand) | *(internal only)* | Public brand TBD from top 3 | High | Do not ship “Vault” |
| Your collection, shelved | Your collection, in the fire | Craft tagline sketch | Low | Needs real brand line after top 3 |
| Spine strip (binders) | Rack | Binders on the rack | Med | Or *Line* |
| Page tabs | Plates | Working plates in the crucible | Med | |
| Theme note, set, or hunt… | Intent, set, or run… | Less vault/hunt; more craft intent | Med | |
| Center = Chase #1 | Center = Keystone | Transformation focus piece | Med | Or keep Chase for TCG feel |

---

## Ledger (value rail)

| Current label | Craft-themed label (guess) | Why | Confidence | Later notes |
| --- | --- | --- | --- | --- |
| Ledger | Assay | Value read — ranges, not fake precision | High | Fits VIP rules |
| Page / Binder (scope) | Plate / Binder | Scope of assay | Med | |
| Total market | Marked value | Sum of tempered marks | Med | |
| Owned | Alloyed | Fused into owned set | Med | Align with Alloy Owned |
| Still need | Still raw | Not yet acquired / seated | Med | Alt: *Unforged* |
| Delta | Spread | Owned − need | Low | Keep Delta if clearer |
| Prices as of … | Tempered as of … | Freshness of last temper | High | |
| Select all | Select all | Neutral | High | |
| All in scope | Whole plate / Whole binder | | Med | |
| Own / Need (row) | Alloyed / Raw | Per-line owned flip | Med | |

---

## Pocket actions

| Current control | Craft-themed label (guess) | Why | Confidence | Later notes |
| --- | --- | --- | --- | --- |
| Owned toggle | Alloy | Mark owned / fused in | High | |
| Wishlist / ★ | Mark | Want / future temper | Med | |
| View / zoom | Assay | Inspect without deciding | High | |
| Remove / clear | Quench | Clear pocket | Med | |
| Drag rearrange | Reseat | Move between pockets | Med | |
| Empty pocket | Empty pocket | Keep plain | High | |

---

## Search dock / filters

| Current label | Craft-themed label (guess) | Why | Confidence | Later notes |
| --- | --- | --- | --- | --- |
| All / TCG.io / TCGdex | Keep | Vendor truth names | High | |
| Rarity / Type chips | Keep TCG terms | Domain vocabulary | High | |
| Clear filters | Clear | Neutral | High | |
| Set chips | Keep set names | Product names | High | |
| Place / click-to-fill | Seat | Drop into pocket | Med | |

---

## Product-name shortlist → face mapping (later)

Pending your **top 3**. Best-guess assignment for when public names replace internal ones:

| Craft name | Could later name… | Rationale |
| --- | --- | --- |
| **Crucible** | Whole platform or collector face | Where value is tested / transformed |
| **Forge** | Builder surface (today’s Binder Vault) | Where pages/pockets are made |
| **Temper** | Pricing / quality / sync layer | Refining marks & owned state |
| **Alloy** | Integration / inventory merge (VIP bridge) | Combining sources into one holding truth |
| **Anvil** | Stable workspace / mobile show mode | Where decisions get struck |
| **Catalyst** | Agents / Orchestr8-class layer | What starts the run |

---

## Explicitly out of scope (for now)

- Applying renames in `BinderVault.tsx` / CSS / routes
- USPTO / domain filing (tracked in branding conversation, not this file)
- Picking the public top 3 product names (your call next)

When top 3 are chosen, freeze product names first, then apply this map in a dedicated rename PR.
