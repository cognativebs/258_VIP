# Binder Vault

A local-first digital card-binder builder. Combines the themed 9-slot "era" pages
and drag-and-drop of `ME_Drag_Drop_Binder_Templates.html` with the shelf / multi-layout
binder experience of `binder-builder.html`, then adds:

- **Drag-and-drop** — drop image files straight from your computer into any pocket, drag
  cards from the search dock onto a pocket, or drag a card between pockets to re-order.
- **Live Pokémon card search** across two current databases:
  - [`pokemontcg.io`](https://pokemontcg.io) — rich metadata + TCGplayer market price + `_hires` art.
  - [`TCGdex`](https://tcgdex.dev) — open, no API key, explicit **600×825** high-res art
    (`.../high.png`).
- **High-res images**: results and the lightbox use the large/high asset URLs. See
  "Where the images come from" below.
- **Postgres persistence** via Drizzle + `pg` in schema `vault_tcg` (ADR 0007). Same
  database as comics. Every card placement stores **provenance** (source, method, model
  version, confidence, verification status) — no inferred value is stored as if verified.

## Setup

From the repo root:

```bash
npm install
# Postgres up + migrations (creates vault_tcg.*)
python scripts/migrate_db.py
# Optional: import an old local SQLite file once
python scripts/migrate_binder_sqlite_to_postgres.py \
  --sqlite apps/binder-vault/.data/binder-vault.sqlite
npm run binder          # → http://localhost:3010
```

### Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `BINDER_DATABASE_URL` / `IQVAULT_DATABASE_DSN` / `DATABASE_URL` | Postgres DSN (shared with VIP) | `postgresql://postgres:vault@localhost:5432/iqvault` |
| `BINDER_MEDIA_DIR` | Uploaded image cache dir | `apps/binder-vault/.data/media` |
| `POKEMONTCG_API_KEY` | Raises pokemontcg.io limit to 20k/day (free at dev.pokemontcg.io) | none (1k/day) |
| `VIP_API_URL` | VIP API for Sync Owned (use LAN IP on phone) | `http://127.0.0.1:8787` |
| `BINDER_DB_PATH` | **Deprecated** — SQLite import input only | — |

### Phone / LAN

Binder listens on `0.0.0.0:3010`. On the same Wi‑Fi open `http://<your-PC-LAN-IP>:3010`.
See [docs/how-to/04-binder-lan-and-iqvault.md](../../docs/how-to/04-binder-lan-and-iqvault.md).

## Where the images come from

| Need | Source | Notes |
| --- | --- | --- |
| High-res transparent art (print) | TCGdex `https://assets.tcgdex.net/en/{set}/{no}/high.png` | 600×825, PNG/WebP, no key |
| Metadata + market price | pokemontcg.io `images.large` (`_hires`) | ~734×1024, price can lag the market |

Both are queried in parallel; a failing source never blocks the other.

## Data model (SQLite)

- `binder` — name, spine color, rows, cols, optional era `template`.
- `binder_page` — ordered pages; title, subtitle, tone.
- `binder_slot` — one per pocket; holds the placed card + **provenance columns**.

Uploaded images are stored on disk under the media dir; the DB keeps the filename +
provenance (`method=user_upload`, `verification_status=unverified`). Catalog cards store the
source URL + provenance and are fetched on demand.

## API surface

| Method | Route | Purpose |
| --- | --- | --- |
| GET/POST | `/api/binders` | list / create |
| GET/PATCH/DELETE | `/api/binders/:id` | read / rename / delete |
| POST | `/api/binders/:id/pages` | add a page |
| PATCH/DELETE | `/api/pages/:id` | edit meta / delete |
| PUT/DELETE | `/api/slots/:id` | place card·upload·move / clear |
| GET | `/api/cards/search?q=&source=` | unified card search |
| POST | `/api/media` · GET `/api/media/:name` | upload / serve cached image |
