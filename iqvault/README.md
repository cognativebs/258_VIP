# IQVault Vite proof — **ARCHIVED**

> **Use `apps/iqvault-web` on `:3000` instead.**

This Vite app (`Personal Intelligence · 258 Labs` on **:5175**) was the early
collector proving ground: gold-dark shell, comics Bloomberg terminal, and rich
hunt cards.

As of 2026-08-08 those surfaces are merged into the Next.js collector face:

| What moved | Where now |
| --- | --- |
| Gold-dark Personal Intelligence theme | `apps/iqvault-web` globals |
| Comics terminal (filters / workspaces / inspector) | `/collections/comics` |
| Hunt cards + detail explorer | `/hunts` (VIP `/api/hunts`) |
| Portfolio / recs / signals / sell queue / … | existing `:3000` routes on VIP API |

## Do not extend this app

New collector UX goes in `apps/iqvault-web`. This tree remains as a reference for
Orchestr8 analytics chat / team panels not yet ported, and for historic hunt seed
modules under `src/data/hunts/`.

## Run the live face

```bash
npm run api    # VIP :8787
npm run web    # collector face :3000
# optional full comics Postgres grid:
# docker compose up -d && python api/comics_server.py   # :5200
```

Optional: `NEXT_PUBLIC_BINDER_URL=http://localhost:3010` for the Binder nav link.
