# How-To: See TCG collections in the same Bloomberg view as comics

**Short answer today:** TCG from Binder SQLite now appears in the VIP Portfolio via the API adapter, still in a separate Binder tab/window for layout. A single comics+TCG Bloomberg grid remains a later milestone.

## What each surface shows

| Face | URL | Inventory |
|------|-----|-----------|
| **Comics Bloomberg-style UI** (legacy IQVault) | http://127.0.0.1:5175 | Archived reference. Use collector `/collections/comic`. |
| **VIP collector face** (Next) | http://127.0.0.1:3000/collections/comic | Live comics terminal + Orchestr8 Analytics. TCG/sports terminals under `/collections/*`. |
| **Binder Vault** | http://127.0.0.1:3010 (LAN IP on phone) | Your TCG binders / pockets / owned-wishlist (shared SQLite truth for TCG) |
| **Orchestr8 Console Analysis** | http://127.0.0.1:3001 → Analysis | Comics API first, VIP sample fallback — for AI advice, not a card grid |

Bloomberg restyle of `apps/iqvault-web` is still on the backlog under **Later** (`docs/backlog.md`).

## What you can do now

### A. Comics “Bloomberg” / vault analytics (existing)

1. Ensure Postgres + Comics API are up (`:5432`, `:5200`).
2. Open http://127.0.0.1:3000/collections/comic
3. Use filters / Inspector | Analytics for comics (Museum / Investment / Liquidity scores).

### B. TCG collection (existing, separate app)

1. Open http://127.0.0.1:3010 (or IQVault web → **Binder** nav link).
2. Build pages, place cards (pokemontcg / TCGdex).
3. Click **Sync Owned (VIP)** to mark pockets owned when they match VIP inventory `externalIds` (seed ids like `base1-4`).

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
Comics vault UX  →  :3000/collections/comic
TCG terminal     →  :3000/collections/pokemon (Binder layout still :3010)
Sports terminals →  :3000/collections/football|soccer|basketball|baseball
Shared AI advice →  collector Analytics tab or Orchestr8 Console (:3001)
VIP list/API     →  :3000 / :8787
```

## How to request the build (recommended)

In **Orchestr8 Console** → **Build Spec** (Build Spec Council), paste a goal like:

> Unify TCG owned Binder slots and comics holdings into one Bloomberg-style grid on the IQVault collector face. Preserve `external_id`, provenance, and no fake precision. Adapter-swappable; Binder stays layout UX; VIP owns inventory truth.

Then implement the emitted spec in Cursor (ADR 0003).
