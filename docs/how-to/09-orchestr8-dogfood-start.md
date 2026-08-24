# Orchestr8 dogfood: start the gateway + console and confirm health

Goal: from a cold Windows machine, get the gateway on `:5210` and the console on
`:3001`, confirm both are healthy, and run a Build Spec council that writes a
critic-passed spec into `docs/specs/`.

Repo root on the workstation: `D:\Projects\Business_Ideas\258_Labs\258_VIP`.
Every command below assumes you started there.

---

## 1. Start the gateway (`:5210`)

Two windows. **Gateway first** — the console's Build Spec tab is useless without it.

```bat
cd /d D:\Projects\Business_Ideas\258_Labs\258_VIP
start_orchestr8.bat
```

`start_orchestr8.bat` does `cd /d "%~dp0orchestr8"` itself, so it works from any
cwd — that is the fix for "wrong cwd". Do **not** run `python api/server.py`
from the repo root: the gateway resolves `config/`, `agents/` and `.env`
relative to `orchestr8/`, so the repo-root form fails to find the catalog.

Correct manual form, if you are not using the .bat:

```bat
cd /d D:\Projects\Business_Ideas\258_Labs\258_VIP\orchestr8
python api\server.py
```

A healthy start prints the route list and ends with:

```text
  Providers: {'openai': True, 'anthropic': True, 'grok': True}
  Agents: 24
```

If `orchestr8\.env` is missing you get `WARN: orchestr8/.env is missing — copy
orchestr8/.env.example and add keys.` Keys live **only** in `orchestr8\.env`
(see `05-orchestr8-env-keys.md`). Never paste keys into a launcher or a doc.

## 2. Confirm gateway health

```powershell
Invoke-RestMethod http://127.0.0.1:5210/v1/health
```

Expect:

```json
{ "ok": true, "service": "orchestr8", "providers": { "openai": true, "anthropic": true, "grok": true } }
```

- `ok: false` → no provider key was loaded. Fix `orchestr8\.env`, restart.
- `keyWarnings` present → a key is in the wrong variable (Anthropic keys start
  `sk-ant-`, xAI `xai-`). The startup banner prints the same `WARN:` lines.
- Connection refused → the gateway is not running. Go back to step 1 and read
  the gateway window; it now prints the reason instead of dying silently.

## 3. Start the console (`:3001`)

Second window, **from the repo root** (this is an npm workspace — running it
from `apps\orchestr8-console` is the usual cause of "next not found"):

```bat
cd /d D:\Projects\Business_Ideas\258_Labs\258_VIP
npm run orchestr8:console
```

That runs `next dev -p 3001` in `apps\orchestr8-console`. Open
<http://127.0.0.1:3001>.

If you get `'next' is not recognized` or `next not found`, dependencies were
never installed for the workspace. From the repo root:

```bat
npm install
```

`next` is hoisted to the repo-root `node_modules`, not to
`apps\orchestr8-console\node_modules` — an empty console `node_modules` is
normal and is not the problem.

## 4. Confirm the console sees the gateway

The header pill (`HealthBar`) reads **gateway online**. It calls
`/api/orchestr8/v1/health`, which `apps/orchestr8-console/next.config.ts`
rewrites to `http://127.0.0.1:5210/`. So:

- pill says **offline** but step 2 returned `ok: true` → the console was started
  before the gateway, or on a different port. Reload the page.
- pill says **offline** and step 2 refused → gateway is genuinely down.

## 5. Run a Build Spec council

Build Spec tab → pick a team → ask for the spec. On finish the gateway writes
both files to `docs/specs/`:

- `docs/specs/<id>.md` — the human/Cursor work order
- `docs/specs/<id>.json` — the machine-readable spec

Check the emit:

```powershell
Get-ChildItem docs\specs | Sort-Object LastWriteTime -Descending | Select-Object -First 4
Invoke-RestMethod http://127.0.0.1:5210/v1/specs
```

A spec is only `critic_passed` when Critic actually ran **after** Architect.
Read `provenance.verification_status` and `provenance.critic_review` in the
JSON:

| `critic_review` | meaning |
|-----------------|---------|
| `post_author` | Critic reviewed the authored spec → can be `critic_passed` |
| `pre_author` | Critic ran before Architect → stays `unverified` |
| `critic_failed` | Critic errored → stays `unverified` |
| `none` | no Critic in the roster → stays `unverified` |

If the run finished but nothing landed in `docs/specs/`, the gateway window
prints `[orchestr8] build_spec emit skipped: <reason>` and the result carries
`buildSpecStatus`. That line is the actual reason — read it before re-running.

---

## Common failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Bind failed on 127.0.0.1:5210: address already in use` | a stale gateway still holds the port | `netstat -ano \| findstr :5210` then `taskkill /PID <pid> /F` |
| Health pill `gateway offline`, curl works | console started first / cached page | reload `:3001` |
| `next not found` | deps not installed, or started from the app dir | `npm install` at the **repo root**, start with `npm run orchestr8:console` |
| Gateway exits immediately, empty launcher log | — | stdout is line-buffered now; the log shows the banner and the `WARN:` lines |
| Council dies instantly with `Unknown agent: <id>` | leftover console team naming a deleted custom role | fixed: stale ids are dropped and reported as `droppedRoles`; re-pick the team to clear it |
| Progress dock times out on a long council | one slow role held the stream silent | fixed: the stream emits a heartbeat every 20s, so silence now means the gateway really died |
| `temperature` / `max_tokens` 400 from a provider | model rejects the parameter | adapters retry once with the parameter repaired (`orchestr8/providers/llm.py`) |

## Local verify (no live keys, no spend)

Run from the repo root. The suite is hermetic — `tests/conftest.py` sets
`ORCHESTR8_SKIP_DOTENV=1`, so your real `orchestr8\.env` is **not** loaded and
provider-selection tests behave the same on the workstation as in CI.

```powershell
python -m pytest tests -q
python -m pytest tests\test_orchestr8_build_spec_gates.py -q
npm run typecheck -w @vip/orchestr8-console
```

Gateway boot check without starting the real port:

```powershell
$env:ORCHESTR8_PORT=5211
cd orchestr8; python api\server.py
# other window:
Invoke-RestMethod http://127.0.0.1:5211/v1/health
```
