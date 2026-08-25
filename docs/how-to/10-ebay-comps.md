# eBay comps for Collection Analysis

Comics market evidence on Analysis uses the VIP `ebay-sold` adapter. Without
credentials it stays **idle** and the critic correctly vetoes Sell/Lot.

This is **not** a sold ledger. eBay Marketplace Insights (completed/sold) is
gated. Browse `buy.browse` returns **active listing observations**, marked
`unverified`. Still better than catalog `Current Price` as if it were a comp.

Do **not** put eBay keys in `orchestr8/.env` (LLM keys only).

## 1. Create the eBay app (once)

1. Open https://developer.ebay.com/my/keys and sign in (or register).
2. Create an application if you do not have one.
3. Open the **Production** keyset (not Sandbox — sandbox will not match live comics).
4. Copy:
   - **App ID (Client ID)**
   - **Cert ID (Client Secret)**
5. The app needs the **Buy** / `buy.browse` scope. Client-credentials OAuth uses
   `https://api.ebay.com/oauth/api_scope/buy.browse`. If Production keys are
   locked pending a RuName / user-consent flow, use the **Get OAuth Application
   Token** button on that page as a short-lived fallback (`EBAY_OAUTH_TOKEN`,
   ~2 hours). Prefer App ID + Cert ID so the API refreshes the token.

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

Then Analysis → wait for the **comps** pill. `0/12` can still happen if Browse
returns no items for those titles. `3+/12` is enough for the critic to consider
Sell/Lot on those highlights only.
