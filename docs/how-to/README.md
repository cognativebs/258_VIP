# VIP How-Tos

Operator guides for the collector / Orchestr8 faces. Written against the stack as of 2026-08-02.

## Quick links

| How-To | File |
|--------|------|
| Signals sources & quality | [01-signals-sources-quality.md](01-signals-sources-quality.md) |
| TCG in the Bloomberg / vault view | [02-tcg-in-bloomberg-view.md](02-tcg-in-bloomberg-view.md) |
| Orchestr8 councils (build / comics / agents) | [03-orchestr8-councils.md](03-orchestr8-councils.md) |
| Binder LAN access + IQVault bridge | [04-binder-lan-and-iqvault.md](04-binder-lan-and-iqvault.md) |
| Orchestr8 `.env` keys (OpenAI / Anthropic / xAI) | [05-orchestr8-env-keys.md](05-orchestr8-env-keys.md) |
| Ricoh fi-8170 scan → inventory intake | [06-ricoh-fi8170-scan-intake.md](06-ricoh-fi8170-scan-intake.md) |

## One-shot launcher (preferred)

Double-click **`Launch IQVault.bat`** (or the Desktop **IQVault** shortcut from
`scripts/create_iqvault_shortcut.ps1`). It starts only what is missing and
health-checks each service before opening Comics:

| Order | Service | Port |
|------|---------|------|
| 1 | Docker Desktop + Postgres (`iqvault-postgres`) | 5432 |
| 2 | DB migrations (`scripts/migrate_db.py`) | — |
| 3 | VIP API (`npm run api`) | 8787 |
| 4 | Comics API (`python api/comics_server.py`) | 5200 |
| 5 | Orchestr8 gateway (`python orchestr8/api/server.py`) | 5210 |
| 6 | IQVault web (`npm run web`) | 3000 → `/collections/comics` |

Stop app windows with **`Stop IQVault.bat`** (Postgres stays up). Optional Binder:
`powershell -File scripts\start_iqvault_ecosystem.ps1 -WithBinder`.

Orchestr8 Ask needs at least one key in `orchestr8/.env` (see `.env.example`).

## Service map (local / manual)

| Service | URL | Start |
|---------|-----|--------|
| IQVault web (VIP collector face) | http://127.0.0.1:3000 | `Launch IQVault.bat` or `npm run web` |
| Binder Vault (TCG binders) | http://127.0.0.1:3010 | `npm run binder` |
| VIP API | http://127.0.0.1:8787 | `npm run api` |
| Comics API | http://127.0.0.1:5200 | `python api/comics_server.py` (needs Postgres) |
| Orchestr8 gateway | http://127.0.0.1:5210 | `Launch IQVault.bat` / `start_orchestr8.bat` |
| Orchestr8 Console | http://127.0.0.1:3001 | `npm run orchestr8:console` |
| Legacy IQVault (archived Vite) | http://127.0.0.1:5175 | `npm run dev --prefix iqvault` |

Login for legacy IQVault UI: `greg@iqvault.local` / `vault`.
