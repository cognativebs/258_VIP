# Comics comps for Collection Analysis

eBay **asks are not a valuation source**. LIVE and Analysis do not call
Browse. Comics use PriceCharting guide quotes (unverified, not solds).
eBay keys remain for **selling** (Inventory / offers), not for pricing.

Do **not** put eBay or PriceCharting keys in `orchestr8/.env` (LLM keys only).

## PriceCharting (comics LIVE)

When `PRICECHARTING_API_TOKEN` (or alias `PRICECHARTING_TOKEN`) is set in
`services/api/.env`, comics comps use PriceCharting's official Prices API
(`/api/products` then `/api/product`). Quotes are the current **ungraded/loose
guide** (pennies → USD), labeled unverified. They are **not** written to
`vault_market.sale`.

Nightly snapshot history and the vendor product map are [plan 0004](../plans/0004-pricecharting-core-wiring.md)
/ [ADR 0011](../adr/0011-pricecharting-wiring-on-live-vip.md). LIVE quotes
still write `listing_observation`; that is not the history spine.

1. Subscribe at https://www.pricecharting.com/pricecharting-pro?f=api
2. Subscription page → **API/Download** → copy the 40-character token
3. `PRICECHARTING_API_TOKEN=...` in `services/api/.env`
4. Restart the API, then `python scripts/migrate_db.py` (adds `guide_quote` + source registry)
5. `npm run job:comics-comps -- --publishers=Marvel,DC --max-holdings=12`

GoCollect is not implemented. Their API schema is only visible after login;
we will not scrape the site. If you get docs/access, we can add a second
adapter on the same seam.

Do **not** put PriceCharting tokens in `orchestr8/.env`.

## 1. Create the eBay app (once)

1. Open https://developer.ebay.com/my/keys and sign in (or register).
2. Create an application if you do not have one.
3. Open the **Production** keyset (not Sandbox — sandbox will not match live comics).
   Production stays locked until a public marketplace-deletion URL is live —
   see [11-ebay-marketplace-deletion.md](11-ebay-marketplace-deletion.md).
   Do **not** click Save on that form with localhost or a made-up URL.
4. Copy:
   - **App ID (Client ID)**
   - **Cert ID (Client Secret)**
5. Client-credentials OAuth defaults to public data
   (`https://api.ebay.com/oauth/api_scope`) — that is the scope Production
   apps actually grant. Override with `EBAY_OAUTH_SCOPE` only if eBay grants
   a different client-credentials scope (for example `buy.browse`). Browse
   search may still 403 — that is honest idle, not fabricated comps.
   Short-lived fallback: **Get OAuth Application Token** → `EBAY_OAUTH_TOKEN`
   (~2 hours). Prefer App ID + Cert ID so the API refreshes the token.

You never paste these into git or chat.

## 2. Write the local env file

Paste in PowerShell (repo root). Then put the two values into Notepad and save:

```powershell
cd D:\Projects\Business_Ideas\258_Labs\258_VIP
copy /Y services\api\env.example services\api\.env
notepad services\api\.env
```

Fill:

```text
EBAY_APP_ID=your-app-id
EBAY_CERT_ID=your-cert-id
EBAY_ENVIRONMENT=production
```

Leave `EBAY_OAUTH_TOKEN` blank when App ID + Cert ID are set.

## 3. Restart so VIP :8787 loads the file

```powershell
cd D:\Projects\Business_Ideas\258_Labs\258_VIP
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop_iqvault_ecosystem.ps1
.\Launch IQVault.bat
```

The VIP API window should print `eBay comps: client_credentials (production)`.

## 4. Verify

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

Expect `ebayComps.configured = True` and `ebayComps.mode = client_credentials`.

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/recommendations?limit=1 | ConvertTo-Json -Depth 6
```

Expect comics comps from PriceCharting when `PRICECHARTING_API_TOKEN` is set.
eBay App ID does **not** feed LIVE. Walking the vault is a batched job —
see [plan 0003](../plans/0003-comics-comps-vault-ingest.md). Collection Tab
VALUE stays the CLZ snapshot. Guide quotes land in `vault_market.listing_observation`,
never in `vault_market.sale` and never over CLZ dollars.

## 5. Vault walk (Marvel / DC, then all)

Stop VIP is not required. From repo root in PowerShell (after `git pull` on `main`
and a migrate so `listing_observation` exists):

```powershell
cd D:\Projects\Business_Ideas\258_Labs\258_VIP
npm run job:comics-comps -- --publishers=Marvel,DC --max-holdings=12
```

To replace leftover eBay ask rows, force a refresh:

```powershell
npm run job:comics-comps -- --publishers=Marvel,DC --max-holdings=12 --stale-hours=0
```

Expect a report with `processed` / `wrote` / `unmatched`. Resume the rest:

```powershell
npm run job:comics-comps -- --publishers=Marvel,DC --resume
```

Full comics vault (every publisher): `--publishers=all`. Ctrl+C pauses; `--resume`
continues. Dry-run (`--dry-run`) fetches nothing into Postgres.

LIVE is range + guide-quote count + recency · unverified, beside VALUE, never
instead of it.

## 6. Whole vault + morning SQL history (03:00 CDT)

This walks **every** CLZ comic, updates LIVE, and writes one row per book per
Chicago day into `vault_market.guide_price_observation`. That table is the
history. It is not a sold ledger and it does not overwrite VALUE.

First run (hours — PriceCharting is 1 call/second, two calls per book):

```powershell
cd D:\Projects\Business_Ideas\258_Labs\258_VIP
python scripts\migrate_db.py
npm run job:comics-guide-snapshot
```

Ctrl+C pauses. Continue with `--resume`. Same Chicago day skips books already
snapshotted.

Register the 03:00 daily task (PC clock must be Central Time for CDT):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\schedule_comics_guide_snapshot.ps1
```

Rows: `(holding, raw_ungraded, pricecharting, snapshot_on)`. Re-running the
same morning upserts that day. Query history with `snapshot_on` + `guide_price`.
