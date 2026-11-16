# VIP Shell v1 — build report

**Plan:** `vip_shell/2026-09-22_vip-shell-v1.iqvplan.json`
**Branch:** `cursor/vip-shell-v1`
**Date:** 2026-09-22

## What was built

A five-concept shell in `apps/iqvault-web`: VAULT, INGEST, ADVISOR, SIGNALS, OPERATE, plus Home. Order and landing come from role config (`collector`, `dealer`, `founder`). Founder uses the collector order. The header reads that config through role context. A test fails if a concept order, the OPERATE section order, or a raw color hex shows up outside `roles.ts` and `tokens.css`.

Routes are stable: `/vault`, `/ingest`, `/advisor`, `/signals`, `/operate` and `/operate/[section]`, `/home`. `/` redirects to the active role’s landing. The wordmark goes to Home. The role control in the header is how you see the other orders. The choice is stored in `localStorage`.

Primitives: ValueRange (no scalar prop), VerificationChip, EvidenceRail, InsufficientEvidence, DualMeter, OriginChain, SignalCard behavior inside the reader, StageStrip, ReviewRow, CommandPalette. Screens render typed fixtures, including the degraded cases in the plan: tight comps, wide stale comps, no comps, unverified condition, a full advisor answer, an insufficient-evidence answer with working links, a linked signal, an unlinked signal that falls back to lineage, and a signal that is low fact-confidence and high attention at the same time.

The palette opens from the Search button and from Ctrl+K or ⌘K. Arrow keys move across the group list. Enter does not invent a hit. The stub resolver returns an empty set and the sentence “Search is not connected yet.” The ranking contract and the entity-layer dependency are in `apps/iqvault-web/src/shell/search/contract.ts`.

ADR 0014 is `docs/adr/0014-shell-and-role-ordering.md`.

The old tab bar is gone. The previous portfolio page is at `/portfolio`. The previous signals feed is at `/signals-feed`. Other existing pages (collections, scan, eBay, and the rest) still load at their old URLs and sit under the new header. They are not in the nav.

## Gates left open

- **G-2** Search is a contract and a stub. No index, no ranking implementation.
- **G-3** OPERATE sections are empty states. Sell, listings, transactions, pricing, catalogs, integrations, and jobs do not run.
- **G-4** Shell screens use fixtures. No live inventory or signal query.

Parked with those gates: mobile, Notion, six of the eight signals dashboard views, and wiring Phase B prices.

## Hard stops

None fired.

HS-5 is the closest call. The canvas URL did not load in this session, so spacing and exact arrangement inside the specified regions were taken from the phase task lists and the extracted tokens (ground, rails at 232 and 286, header 56, the three typefaces, caution for insufficient evidence). The plan already named those regions and extracted the tokens. I treated that as enough to build, and I am recording the gap here rather than inventing a second visual system.

## What I would have done differently

- Put local navigation commands in the palette (go to Vault, go to Ingest). They do not need the entity layer. G-2 says the palette is wired to the stub, and the stub returns nothing, so a second command list would have been a search implementation by another name. I left it empty.
- Render VAULT from the holdings already in Postgres. G-4 says fixtures, and Phase B coverage is still unresolved. The coverage strip uses fixture percents (42% of assets, 18% of value) and says so.
- Build the OPERATE workflows the empty states point at. G-3 says shell only.
- Match the Claude canvas pixel for pixel. I could not open it.
- Rewrite the older collection and eBay pages so they stop printing a point price. They are still reachable by URL and still do that. New shell surfaces do not. Pulling those pages onto ValueRange is live-data work this plan parked.
- Cut the branch from `main`. It was cut from `cursor/need-binder-hunts-d2a5` so the uncommitted work already in this checkout stayed put.

## Checks

`npm test -w @vip/iqvault-web` — pass.
`npx tsc -p apps/iqvault-web/tsconfig.json --noEmit` — pass.
