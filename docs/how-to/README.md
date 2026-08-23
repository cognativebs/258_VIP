# VIP How-Tos

Operator guides for the collector / Orchestr8 faces. Written against the live
stack (Launch IQVault → `:3000` / `:8787` / `:5200` / Postgres).

## Quick links

| How-To | File |
|--------|------|
| Signals sources & quality | [01-signals-sources-quality.md](01-signals-sources-quality.md) |
| TCG in the Bloomberg / vault view | [02-tcg-in-bloomberg-view.md](02-tcg-in-bloomberg-view.md) |
| Orchestr8 councils (build / comics / agents) | [03-orchestr8-councils.md](03-orchestr8-councils.md) |
| Binder LAN access + IQVault bridge | [04-binder-lan-and-iqvault.md](04-binder-lan-and-iqvault.md) |
| Orchestr8 `.env` keys (OpenAI / Anthropic / xAI) | [05-orchestr8-env-keys.md](05-orchestr8-env-keys.md) |
| Claude MA from WSL2 (placement, billing, no repo mount) | [09-claude-ma-wsl.md](09-claude-ma-wsl.md) |
| Card price history (TCGplayer, daily) | [08-card-price-history.md](08-card-price-history.md) |
| Ricoh fi-8170 scan → inventory intake | [06-ricoh-fi8170-scan-intake.md](06-ricoh-fi8170-scan-intake.md) |
| CLZ inbox sync (scheduled XML drop) | [07-clz-inbox-sync.md](07-clz-inbox-sync.md) |

**Weekend live-ops plan** (news → Orchestr8, inventories + ranges, launch, bulk scan / eBay): [`docs/plans/0002-live-ops-weekend.md`](../plans/0002-live-ops-weekend.md).

## One-shot launcher (preferred)

Double-click **`Launch IQVault.bat`** (or the Desktop **IQVault** shortcut from
`scripts/create_iqvault_shortcut.ps1`). It health-checks each service, restarts
stale listeners (VIP, Comics API, web, Binder), then opens the Pokémon
terminal (and Comics). Binder Vault is started but not opened in the browser:

| Order | Service | Port |
|------|---------|------|
| 1 | Docker Desktop + Postgres (`iqvault-postgres`) | 5432 |
| 2 | DB migrations (`scripts/migrate_db.py`) | — |
| 3 | VIP API (`npm run api`) | 8787 |
| 4 | Comics API (`python api/comics_server.py`) | 5200 |
| 5 | Orchestr8 gateway (`python orchestr8/api/server.py`) | 5210 |
| 6 | IQVault web (`npm run web`) | 3000 → `/collections/pokemon` |

Stop app windows with **`Stop IQVault.bat`** (Postgres stays up). Binder Vault
(`:3010`) starts with the stack (open it from **Binder ↗** on the Pokémon tab);
pass `-NoBinder` to skip it.

`npm run api` is **only** the VIP API (`:8787`). Comics API is a separate
Python process (`:5200`). Launch IQVault starts both. Piecemeal:

```text
npm run api
npm run comics
npm run web
```

Orchestr8 Ask needs at least one key in `orchestr8/.env` (see `.env.example`).

## Service map (local / manual)

| Service | URL | Start |
|---------|-----|--------|
| IQVault web (VIP collector face) | http://127.0.0.1:3000 | `Launch IQVault.bat` or `npm run web` |
| — Collections hub | http://127.0.0.1:3000/collections | Comics + Pokémon + Sports |
| — Comics terminal | http://127.0.0.1:3000/collections/comics | CLZ buttons + XML drop zone |
| — Pokémon TCG | http://127.0.0.1:3000/collections/pokemon | NAME in the grid; card art in Inspector (same as comics) |
| — Sports (stub) | http://127.0.0.1:3000/collections/sports | catalog only until ingest |
| — Scan intake (Ricoh fi-8170) | http://127.0.0.1:3000/scan | needs `VIP_SCAN_INBOX` |
| Binder Vault (TCG binders) | http://127.0.0.1:3010 | `npm run binder` (Launch starts this; `-NoBinder` skips) |
| VIP API | http://127.0.0.1:8787 | `npm run api` |
| Comics API | http://127.0.0.1:5200 | `npm run comics` / `python api/comics_server.py` (needs Postgres) |
| CLZ sync | drop XML in inbox | `npm run job:clz-sync` — see [07-clz-inbox-sync.md](07-clz-inbox-sync.md) |
| Orchestr8 gateway | http://127.0.0.1:5210 | `Launch IQVault.bat` / `start_orchestr8.bat` |
| Orchestr8 Console | http://127.0.0.1:3001 | `npm run orchestr8:console` |
