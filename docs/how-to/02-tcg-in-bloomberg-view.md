# How-To: See TCG collections in the same Bloomberg view as comics

**Short answer today:** Pokémon has a first-class nav tab at **http://127.0.0.1:3000/collections/pokemon** (Binder holdings + Binder / CLZ buttons). There is no `/collections/tcg` route. Drop-to-inbox is still Comics-only.

## What each surface shows

| Face | URL | Inventory |
|------|-----|-----------|
| **Comics terminal** | http://127.0.0.1:3000/collections/comics | Live Postgres comics via Comics API `:5200` |
| **Pokémon TCG** | http://127.0.0.1:3000/collections/pokemon | **NAME** in the grid (printed card), set, number, rarity, value; cover art in the Inspector tab (same pattern as comics) |
| **Sports terminal (stub)** | http://127.0.0.1:3000/collections/sports | Catalog schema only (`vault_sports`); no holdings ingest |
| **VIP collector face** (Next) | http://127.0.0.1:3000 | Comics + live Binder TCG holdings from Postgres via VIP API |
| **Binder Vault** | http://127.0.0.1:3010 (LAN IP on phone) | TCG binders / pockets / owned-wishlist (`vault_tcg` in Postgres) |
| **Orchestr8 Console Analysis** | http://127.0.0.1:3001 → Analysis | VIP API first (inventory + comps), Comics API fallback — for AI advice, not a card grid |

The collector face on `:3000` is already Bloomberg-styled. A **single** comics+TCG grid is still backlog F.

## What you can do now

### A. Comics “Bloomberg” / vault analytics (existing)

1. Ensure Postgres + Comics API are up (`:5432`, `:5200`).
2. Open http://127.0.0.1:3000/collections/comics (CLZ Cloud / Comic Collector buttons + XML drop zone).

### B. TCG collection (existing, separate app + new tab)

1. IQVault web → **Pokémon** (`/collections/pokemon`) — Binder holdings, Binder / CLZ buttons; drop zone disabled.
2. Open http://127.0.0.1:3010 (or **Binder ↗** / the TCG tab’s Binder button).
3. Build pages, place cards (pokemontcg / TCGdex).
4. Click **Sync Owned (VIP)** to mark pockets owned when they match VIP inventory `externalIds` (seed ids like `base1-4`).

### C. See a tiny TCG slice inside VIP Portfolio

1. Open http://127.0.0.1:3000 → Portfolio.
2. Look for Pokémon seed holdings (Charizard / Pikachu / etc.) — these exist so Binder sync has something to match.
3. This is **not** your full Binder; it’s a bridge seed.

## What “same Bloomberg view” means when we build it

One collector grid that can show:

- comics rows (from Comics/VIP holdings), and  
- TCG rows (from Binder owned slots / VIP holdings with `externalIds`),  

with shared columns (pillar, scores, recommendation, sell priority) and provenance — without forking a second inventory brain.

Until that ships, the honest workflow is:

```
Comics terminal  →  :3000/collections/comics
Pokémon terminal →  :3000/collections/pokemon  and  :3010
Sports stub      →  :3000/collections/sports
Shared AI advice →  Orchestr8 Console Analysis (:3001)
VIP list/API     →  :3000 / :8787
```

## How to request the build (recommended)

In **Orchestr8 Console** → **Build Spec** (Build Spec Council), paste a goal like:

> Unify TCG owned Binder slots and comics holdings into one Bloomberg-style grid on the IQVault collector face. Preserve `external_id`, provenance, and no fake precision. Adapter-swappable; Binder stays layout UX; VIP owns inventory truth.

Then implement the emitted spec in Cursor (ADR 0003).
