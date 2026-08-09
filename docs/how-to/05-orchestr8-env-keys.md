# Orchestr8 `.env` keys

Gateway keys live only in `orchestr8/.env` (gitignored). Template: `orchestr8/.env.example`.

## Reset a mixed-up file (Windows)

```powershell
cd D:\Projects\Business_Ideas\258_Labs\258_VIP
copy /Y orchestr8\.env.example orchestr8\.env
notepad orchestr8\.env
```

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

## Verify

```powershell
Invoke-RestMethod http://127.0.0.1:5210/v1/health
```

Expect `ok: true` and providers you filled as `true`. If keys are swapped, `keyWarnings` lists which line to fix. The gateway also prints `WARN:` lines on startup.
