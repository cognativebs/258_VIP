# How-To: Refresh comics from CLZ on a schedule

CLZ has **no public API**. Comic Collector has **no CLI export**. The scheduled connection is a drop folder: you export XML; IQVault archives the file, reloads Postgres, and reports what changed.

## One-time setup

1. Apply the holdings migration (adds `dropped_at`, keeps sold books in the DB):

```bash
python scripts/migrate_db.py
```

2. Folders are created on first run:

| Role | Default (Windows, if `E:` exists) | Fallback |
|------|-----------------------------------|----------|
| Inbox | `E:\ComicArchive\inbox\` | `clz-inbox\` in the repo |
| Archive | `E:\ComicArchive\YYYY-MM-DD_<hash>.xml` | `clz-inbox\archive\` |
| Processed | `inbox\processed\` | same |

Override with `CLZ_INBOX_DIR` and `CLZ_ARCHIVE_DIR`. DSN: `IQVAULT_DATABASE_DSN` or `DATABASE_URL` (default `dbname=iqvault user=postgres password=vault host=localhost`).

3. Leave the job running with the rest of the stack, or poll manually:

```bash
npm run job:clz-sync
```

`npm run start -w @vip/jobs -- schedule` polls the inbox every 6 hours (and Pokémon drops hourly). Empty inbox is a no-op.

## Each time you catalog in CLZ

1. Open the Comics terminal (`:3000/collections/comics`). **CLZ Cloud** and **Comic Collector** open CLZ in a new window.
2. In Comic Collector: **File → Export to → XML → All Comics**.
3. Drop the XML onto the terminal (or click the drop strip). The Comics API writes it into the **inbox** the job already watches (`E:\ComicArchive\inbox\` or `clz-inbox\`). The browser cannot write `E:\` itself.
4. The API kicks `clz-sync` in the background. Wait for the strip to say processed, or run `npm run job:clz-sync`.

You can still save the file into the inbox folder by hand if you prefer.

IQVault then:

- SHA-256 the XML. Same bytes as last time → **already current**, file moved to `processed\`.
- Otherwise INSERT `vault_evidence.raw_snapshots` (immutable), copy to the archive, parse, upsert holdings, mark missing books with `dropped_at` (never DELETE).
- Comics terminal (`:3000/collections/comics`) shows **Postgres live** with the new snapshot date. Sold books leave the grid.

## Terminal drop (Comics API)

```bash
curl http://127.0.0.1:5200/api/comics/inbox
curl -X POST http://127.0.0.1:5200/api/comics/inbox \
  -H "X-Filename: export.xml" \
  --data-binary @export.xml
```

`GET` returns the inbox path and pending XML count. `POST` saves the file and starts sync. Next.js rewrites `/api/comics/*` to `:5200`, so the collector drop zone uses the same routes.

Override CLZ window URLs with `CLZ_CLOUD_URL` / `CLZ_COLLECTOR_URL` (API) or `NEXT_PUBLIC_CLZ_CLOUD_URL` / `NEXT_PUBLIC_CLZ_COLLECTOR_URL` (UI fallback).

## Check

```bash
curl http://127.0.0.1:5200/api/comics/health
curl http://127.0.0.1:5200/api/comics/meta
```

`holdings` / `recordCount` should match the export. `snapshotLabel` should be the ingest day, not the original July 2026 load.

## Out of scope

No CLZ Cloud login, no `*.cmc` database reads, no UI automation of the Export dialog. Prices stay CLZ catalog snapshots with provenance — not live comps.
