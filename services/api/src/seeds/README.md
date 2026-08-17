# Seed / fixture files

These JSON files are **test fixtures and bridge seeds**, not runtime inventory.

| File | Role |
|------|------|
| `inventory-sample.json` | Unit-test comics fixture only. Injected via `createApp({ loadComics })`. Never served as the live collection. |
| `sell-queue-sample.json` | Unused at runtime. Sell queue is derived from live holdings. Kept for historical reference; safe to delete once nothing imports it. |
| `pokemon-holdings-sample.json` | Temporary TCG bridge (5 cards) so Binder Sync Owned has `externalIds` to match when Binder Postgres is empty. Not a substitute for full TCG holdings. |
| `hunts.ts` | Hunt definitions (Absolute Batman, Pokémon 30th). Still seed data until hunts move to Postgres. |

Live comics inventory comes from Postgres via `src/lib/comicsHoldings.ts`.
