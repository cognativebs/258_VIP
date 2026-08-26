# eBay Production: marketplace account deletion URL

eBay will not unlock a **Production** keyset until a public `https://` endpoint
answers their challenge. Local IQVault (`127.0.0.1:8787`) cannot be that URL —
eBay cannot reach your PC. **Do not click Save** in the developer portal until
the public URL returns `configured: true`.

VIP does not already have a public website. The public front is a small
Cloudflare Worker (`infra/ebay-deletion-worker/`). The same handler also lives
on VIP at `GET`/`POST` `/api/ebay/marketplace-deletion` for local proof.

Challenge hash (order is mandatory):

`SHA256(challenge_code + verification_token + endpoint_url)`

The `endpoint_url` string must match the portal field **exactly** (no extra
slash, same host).

POST notices are acknowledged immediately. VIP Browse comps never store eBay
user accounts, so `deletedRecords` is always `0` — that is honest, not a
silent wipe.

## 1. Create a free Cloudflare account (once)

1. Open https://dash.cloudflare.com/sign-up
2. Finish signup. You do **not** need a domain. A `workers.dev` hostname is enough.
3. Reply in chat: **Cloudflare account ready**.

Do not click eBay Save yet. Do not deploy yet unless you already have Wrangler
logged in and want the next command.

## 2. After the account exists — one command

Pull this branch, then paste (repo root). A browser window opens for Cloudflare
login the first time. **Do not click eBay Save until the script prints LIVE.**

```powershell
cd D:\Projects\Business_Ideas\258_Labs\258_VIP
git pull origin cursor/ebay-comps-auth-058c
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy_ebay_deletion_worker.ps1
```

The script writes a verification token to
`infra\ebay-deletion-worker\.verification-token` (gitignored). Paste that file
plus the printed `https://vip-ebay-deletion.<subdomain>.workers.dev` URL
(no trailing slash) plus your contact email into the eBay form, then Save.

## Local proof (optional, not public)

After pulling this branch and restarting VIP:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/ebay/marketplace-deletion
Invoke-RestMethod http://127.0.0.1:8787/health
```

`ebayDeletion.configured` stays `false` until
`EBAY_DELETION_VERIFICATION_TOKEN` and `EBAY_DELETION_ENDPOINT_URL` are set in
`services/api/.env` to the **public** Worker URL. Localhost URLs are rejected
on purpose.
