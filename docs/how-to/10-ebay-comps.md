# eBay comps for Collection Analysis

Comics market evidence on Analysis uses the VIP `ebay-sold` adapter. Without
credentials it stays **idle** and the critic correctly vetoes Sell/Lot.

This is **not** a sold ledger. eBay Marketplace Insights (completed/sold) is
gated. Browse search returns **active listing observations**, marked
`unverified`. Still better than catalog `Current Price` as if it were a comp.

Do **not** put eBay keys in `orchestr8/.env` (LLM keys only).

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

Expect `compsSource` not `none` **or** an `emptyReason` about no matched items
(credentials worked; that title is thin). `EBAY_APP_ID` / idle means the `.env`
was not loaded — confirm the file is `services\api\.env` and VIP was restarted.

Then Analysis → wait for the **comps** pill (and **eBay** / **liquidation** pills).
`0/12` can still happen if Browse returns no items for those titles. Challenge
**must veto** Sell/Lot while `liquidation` is `blocked`. That is the product.

**Challenge Council condition:** re-run adapters with valid tokens, then require
`matchedSales >= 3` (`liquidationGate.eligibleHoldingIds`). Click **Re-run comps**
or **Run** (Run always re-fetches). Do not liquidate until `liquidation` is
`conditional` and the title is in `eligibleHoldingIds`.

Walking the **whole** comics vault is a batched job, not an Analysis uncap —
see [plan 0003](../plans/0003-comics-comps-vault-ingest.md). Collection Tab
VALUE stays the CLZ snapshot. Browse asks land in `vault_market.listing_observation`,
never in `vault_market.sale` and never over CLZ dollars.

## 5. Vault walk (Marvel / DC, then all)

Stop VIP is not required. From repo root in PowerShell (after `git pull` on `main`
and a migrate so `listing_observation` exists):

```powershell
cd D:\Projects\Business_Ideas\258_Labs\258_VIP
npm run job:comics-comps -- --publishers=Marvel,DC --max-holdings=12
```

Expect a report with `processed` / `wrote` / `unmatched`. Resume the rest:

```powershell
npm run job:comics-comps -- --publishers=Marvel,DC --resume
```

Full comics vault (every publisher): `--publishers=all`. Ctrl+C pauses; `--resume`
continues. Dry-run (`--dry-run`) fetches nothing into Postgres.

A future LIVE column is range + listing count + recency · unverified, beside
VALUE, never instead of it.
