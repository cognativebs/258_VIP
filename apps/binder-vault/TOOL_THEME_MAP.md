# Binder Vault — tool name → theme map (draft)

**Status:** mapping only — **do not rename UI yet.**  
**Date:** 2026-08-05  
**Scope:** user-facing Binder Vault tool / button labels.

## Theme basis (best guess)

No separate theme glossary was pasted into chat. Destination names below lean on the
language Binder Vault already uses:

> **Vault · Binder · Shelf · Spine · Page · Pocket · Chase · Hunt · Ledger · Seal · Stamp**

Tagline already in UI: *“Your collection, shelved.”*  
Swap the **Themed label** column when a formal theme list lands.

Confidence: **High** = already on-theme or near-exact. **Med** = solid fit. **Low** = stretch; revisit.

---

## Topbar / binder tools

| Current label | Themed label (guess) | Why | Confidence | Later notes |
| --- | --- | --- | --- | --- |
| Copy URL | Share Shelf | LAN / phone open of this shelf | Med | Keep “Copy” in tooltip |
| + New Binder | + Open Binder | Opening a new spine on the shelf | Med | Or *+ New Spine* if spines stay primary nav |
| + Create your first binder | Open your first binder | Empty-state CTA | Med | |
| Cards | Card Hunt | Mobile opens search dock | Low | Or keep *Cards* — short is better on phone |
| Search | Hunt | Search dock verb | Med | Source tabs stay vendor names |
| Close | Close | Neutral; leave | High | |
| ‹ Prev / Next › | ‹ Prev leaf / Next leaf › | Page-as-leaf metaphor | Low | “Page” may stay clearer |
| + Add Page | + Add Leaf | Insert page into binder | Med | Alt: *+ Insert Page* |
| Delete Page | Tear Page | Remove a leaf | Low | Soften to *Remove Page* if “Tear” feels harsh |
| Move / Copy Page | Relocate Leaf | Move/copy between binders | Med | Split later: *Move Leaf* / *Duplicate Leaf* |
| Sync Prices | Stamp Prices | Stamp market marks onto pockets | High | Fill-missing only |
| Syncing… | Stamping… | Busy state for price stamp | High | |
| Refresh All | Re-Stamp All | Force re-observe prices on page | High | Pair with Sync Prices |
| Sync Owned (VIP) | Seal Owned | Match VIP inventory → seal as owned | High | Tooltip: Vault / IQVault match |
| Highlight Missing | Hunt Gaps | Dim owned; gaps stay bright | High | On-state: *Hunt Gaps: On* |
| Export Wishlist | Export Hunt List | Starred wants → store PDF | High | |
| Save as PDF… / Building… | Pressing PDF… | Print metaphor for export busy | Low | |
| Print Page | Press Page | Physical print of the leaf | Med | |
| Delete Binder | Retire Binder | Remove spine from shelf | Med | Keep danger styling |

---

## Shelf / spine / page chrome

| Current label | Themed label (guess) | Why | Confidence | Later notes |
| --- | --- | --- | --- | --- |
| Binder Vault (brand) | Binder Vault | Keep — already theme | High | Do not weaken brand |
| Your collection, shelved | Your collection, shelved | Keep | High | |
| Spine strip (binders) | Shelf | Nav is already spines on a shelf | High | Aria: *Shelf* |
| Page tabs | Leaves | Ordered pages in the binder | Med | Drag-reorder = *reshuffle leaves* |
| Theme note, set, or hunt… (placeholder) | Theme note, set, or hunt… | Keep | High | Already on-theme |
| Center = Chase #1 | Center = Chase #1 | Keep | High | Era role language |

---

## Ledger (value rail)

| Current label | Themed label (guess) | Why | Confidence | Later notes |
| --- | --- | --- | --- | --- |
| Ledger | Ledger | Keep | High | Already on-theme |
| Page / Binder (scope tabs) | Leaf / Binder | Scope of the ledger | Med | Or keep Page |
| Total market | Marked value | Sum of stamped marks | Med | Avoid fake precision in copy |
| Owned | Sealed | In-hand / owned | Med | Align with Seal Owned |
| Still need | Still hunting | Gaps / wants | High | |
| Delta | Spread | Owned mark − need mark | Low | Or keep Delta |
| Prices as of … | Stamps as of … | Freshness of price stamps | Med | Or *Marks as of …* |
| Select all | Select all pockets | Clarity | High | |
| All in scope | Whole leaf / Whole binder | Clear selection reset | Med | |
| Own / Need (row toggle) | Sealed / Hunting | Per-line owned flip | Med | |

---

## Pocket actions

| Current label / control | Themed label (guess) | Why | Confidence | Later notes |
| --- | --- | --- | --- | --- |
| Owned toggle | Seal | Mark pocket owned | High | |
| Wishlist / ★ | Hunt mark | Want / chase list | High | |
| View / zoom | Inspect | Full-res look | Med | |
| Remove / clear | Eject | Clear pocket | Med | Alt: *Clear pocket* |
| Drag rearrange | Reseat | Move card between pockets | Med | Touch: *Tap to reseat* |
| Empty pocket drop target | Empty pocket | Keep plain | High | |

---

## Search dock / filters

| Current label | Themed label (guess) | Why | Confidence | Later notes |
| --- | --- | --- | --- | --- |
| All / TCG.io / TCGdex | All / TCG.io / TCGdex | Keep vendor names | High | Not theme candidates |
| Rarity / Type chips | Keep TCG terms | Domain vocabulary | High | Common, Holo, SIR… stay |
| Clear filters | Clear sieves | Optional flavor | Low | *Clear filters* is clearer |
| Set chips (Pitch Black, etc.) | Keep set names | Product names | High | |
| Place / click-to-fill | Seat card | Drop into pocket | Med | |

---

## Transfer / wishlist modals (verbs)

| Current label | Themed label (guess) | Why | Confidence | Later notes |
| --- | --- | --- | --- | --- |
| Move page | Move leaf | | Med | |
| Copy page | Duplicate leaf | | Med | |
| Cancel | Cancel | Keep | High | |
| Confirm / Save | Confirm / Seal | Save = seal where it fits | Low | Don’t over-theme dialogs |

---

## Suggested “theme kit” for later copy passes

Use sparingly so the UI doesn’t become a thesaurus:

| Theme word | Intended meaning |
| --- | --- |
| Shelf | The binder strip / collection home |
| Spine | One binder |
| Leaf | One page |
| Pocket | One slot |
| Chase | Center / hero card role |
| Hunt | Search, gaps, wishlist |
| Ledger | Value calculator rail |
| Stamp | Price observe / write |
| Seal | Owned / verified-in-vault mark |
| Reseat | Move card between pockets |
| Retire | Delete binder |

---

## Explicitly out of scope (for now)

- Orchestr8 agent / `allowed_tools` names (`read_file`, `grep`, …)
- VIP decision verbs (Buy / Hold / Grade / Sell / Lot / Pass) — different layer
- Applying any rename in `BinderVault.tsx` or CSS

When a formal theme list arrives, update the **Themed label** column first; only then open a rename PR.
