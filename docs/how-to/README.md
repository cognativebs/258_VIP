# VIP How-Tos

Operator guides for the collector / Orchestr8 faces. Written against the stack as of 2026-08-02.

## Quick links

| How-To | File |
|--------|------|
| Signals sources & quality | [01-signals-sources-quality.md](01-signals-sources-quality.md) |
| TCG in the Bloomberg / vault view | [02-tcg-in-bloomberg-view.md](02-tcg-in-bloomberg-view.md) |
| Orchestr8 councils (build / comics / agents) | [03-orchestr8-councils.md](03-orchestr8-councils.md) |
| Binder LAN access + IQVault bridge | [04-binder-lan-and-iqvault.md](04-binder-lan-and-iqvault.md) |

## Service map (local)

| Service | URL | Start |
|---------|-----|--------|
| IQVault (comics / Bloomberg-style, archived) | http://127.0.0.1:5175 | `npm run dev --prefix iqvault` |
| IQVault web (VIP collector face) | http://127.0.0.1:3000 | `npm run web` or `Launch IQVault.bat` |
| Binder Vault (TCG binders) | http://127.0.0.1:3010 | `npm run binder` or `Launch IQVault.bat` |
| VIP API | http://127.0.0.1:8787 | `npm run api` |
| Comics API | http://127.0.0.1:5200 | `python api/comics_server.py` (needs Postgres) |
| Orchestr8 gateway | http://127.0.0.1:5210 | `start_orchestr8.bat` / `python orchestr8/api/server.py` |
| Orchestr8 Console | http://127.0.0.1:3001 | `npm run orchestr8:console` |

Login for legacy IQVault UI: `greg@iqvault.local` / `vault`.
