# Orchestr8 `.env` keys

Gateway keys live only in `orchestr8/.env` (gitignored). Template: `orchestr8/.env.example`.

## Reset a mixed-up file (Windows)

```powershell
Set-Location "C:\258Labs\orchestr8"
copy /Y orchestr8\.env.example orchestr8\.env
notepad orchestr8\.env
```

Claude MA from WSL uses the same tree at `/mnt/c/258Labs/orchestr8` — see
[09-claude-ma-wsl.md](09-claude-ma-wsl.md). Do not copy the repo into WSL ext4.

Paste each key on the matching line, save, then restart Orchestr8 (or Launch IQVault.bat).

## Which key goes where

| Variable | Console | Typical prefix |
|----------|---------|----------------|
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys | `sk-proj-...` or `sk-...` |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | `sk-ant-...` |
| `XAI_API_KEY` | https://console.x.ai/ | `xai-...` |

Do **not** put an Anthropic key in `OPENAI_API_KEY` or an OpenAI key in `ANTHROPIC_API_KEY`.
Grok uses `XAI_API_KEY` (alias `GROK_API_KEY` is also accepted).

Optional admin/spend keys (`OPENAI_ADMIN_KEY`, `ANTHROPIC_ADMIN_KEY`, `XAI_MGMT_KEY`) are for the accounts UI only — never paste chat keys there.

## Optional admin spend keys (`/v1/accounts`)

Chat keys and admin keys answer different endpoints:

| Endpoint | Reads | Needs |
|----------|-------|-------|
| `GET /v1/health` | `providers: true` = a **chat** key is present | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY` |
| `GET /v1/accounts` | month-to-date spend / prepaid balance per provider | the admin keys below |

| Variable | What it is | What `/v1/accounts` shows with it |
|----------|------------|-----------------------------------|
| `OPENAI_ADMIN_KEY` | OpenAI **Admin** key (`sk-admin-…`), created by an organization owner under the organization's Admin keys — not a project/chat key | Month-to-date spend from `/v1/organization/costs` (OpenAI has no balance endpoint) |
| `ANTHROPIC_ADMIN_KEY` | Anthropic **Admin** key (`sk-ant-admin-…`), created by an organization admin in the Console — not a chat key | Month-to-date spend from `/v1/organizations/cost_report` (no balance endpoint) |
| `XAI_MGMT_KEY` + `XAI_TEAM_ID` | xAI management key and team id | Real prepaid balance |

Source: `orchestr8/providers/billing.py`.

- **They are optional.** Councils, Ask and every chat call run on the chat keys alone.
- **Without them** only the spend panel is empty: each provider in `/v1/accounts` comes back
  `available: false` with a reason (`Set OPENAI_ADMIN_KEY (sk-admin-…) for spend`). A wrong or
  under-privileged key shows `HTTP 401/403 (admin key … required)` the same way; nothing raises and
  chat keeps working. `/v1/health` can be all green while `/v1/accounts` is unavailable.
- **Do not swap them.** A chat key in an admin line gets a 401/403 on the cost endpoint; an admin key
  in a chat line cannot run completions.
- **Never commit them.** Admin keys read billing for the whole organization (and on OpenAI/Anthropic can
  manage keys and members). They go only in `orchestr8/.env`, which `.gitignore` excludes
  (`.env`, `.env.*`, `*.env`); `orchestr8/.env.example` keeps the names commented out and empty.
  Do not paste them into issues, PR bodies, logs or chat. If one leaks, revoke it in the provider console
  first, then replace it.

## Verify

```powershell
Invoke-RestMethod http://127.0.0.1:5210/v1/health
```

Expect `ok: true` and providers you filled as `true`. If keys are swapped, `keyWarnings` lists which line to fix. The gateway also prints `WARN:` lines on startup.
