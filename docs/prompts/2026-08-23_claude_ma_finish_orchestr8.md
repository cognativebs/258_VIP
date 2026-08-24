# Claude MA mission — finish Orchestr8 (not Viture)

**Operator:** Gregory Williamson  
**Runner:** Claude Managed Agent `agent_01B8ziCmNADfRwKexa969qQg`  
**Environment:** `env_01D8Du4whd8zzNbZe5TGG2Vs` (`o8-workstation`, self-hosted; worker workdir is this repo). Old cloud env `env_01HgSHypqTtC6hNjRwYEucLs` / session `sesn_01FzmMs9o11xf3tNh232zK61` is disconnected — do not reuse.  
**Out of scope:** VITURE / XR glasses / Luma Ultra. That is later, after Orchestr8 can emit a critic-passed build spec for Cursor.

Send the fenced block in §2 as the `user.message` to the MA session.

---

## 1. How this is run (WSL2 on the Windows drive)

Full prereqs, Skill.ai / Claude Platform links, billing, and placement:
[docs/how-to/09-claude-ma-wsl.md](../how-to/09-claude-ma-wsl.md).

Leave the tree on NTFS. Do **not** copy it into the WSL filesystem.

| Side | Path |
|------|------|
| Windows | `C:\258Labs\orchestr8` |
| WSL2 | `/mnt/c/258Labs/orchestr8` |

Gateway keys stay in `orchestr8/.env`. The MA client uses `ANTHROPIC_API_KEY` in the same shell. Sessions bill **$0.08 / running session-hour** plus tokens; idle/terminated time is free. Never pass `file` or `github_repository` resources (self-hosted → HTTP 400). The MA sandbox does **not** see your Windows disk — the mission tells it to `git clone https://github.com/cognativebs/258_VIP.git`.

```bash
cd /mnt/c/258Labs/orchestr8
export ANTHROPIC_API_KEY="sk-ant-...rotated..."
python3 apps/managed-agent-session/session_chat.py \
  --file docs/prompts/2026-08-23_claude_ma_finish_orchestr8.md
```

Windows (same tree):

```powershell
Set-Location "C:\258Labs\orchestr8"
$env:ANTHROPIC_API_KEY = 'sk-ant-...rotated...'
python apps\managed-agent-session\session_chat.py --file docs\prompts\2026-08-23_claude_ma_finish_orchestr8.md
```

(`--file` sends §2 only.)

MA runs on Anthropic's environment. The repo is already placed; Anthropic will not mount it. MA cannot see Greg's `127.0.0.1:5210`. Local verify is still Windows: `start_orchestr8.bat` + `npm run orchestr8:console` + `Invoke-RestMethod http://127.0.0.1:5210/v1/health`.

---

## 2. Paste / send this to MA

```
MISSION — Finish Orchestr8 so a Build Spec council can succeed. Do not work on Viture / XR glasses / Luma Ultra.

SUCCESS (this mission)
Orchestr8 is reliable enough that an operator can start the gateway (:5210) and console (:3001), run a Build Spec council, and get a critic-passed emit under docs/specs/ without empty-provider deaths, temperature 400s, or a leftover team hijacking the roster. You may use any tools, subagents, and repo roles you need. You do not need to start the glasses app.

REPO (you cannot see the operator's disk)
You are in Anthropic's session sandbox. Greg's D:\\ and C:\\258Labs\\orchestr8 are not mounted. If orchestr8/ and AGENTS.md are missing, immediately:
  git clone https://github.com/cognativebs/258_VIP.git
That public URL is 258 Labs' tree. Do not hunt for another orchestr8. Do not ask for a zip or token.

WHAT ORCHESTR8 IS
Python gateway orchestr8/ on :5210 (keys only in orchestr8/.env). Console apps/orchestr8-console on :3001. 22 shipped roles, councils in orchestr8/config/councils.yaml, Full Council id=full. ADR 0003: Orchestr8 authors specs; Cursor builds VIP features. This mission is to make that authoring path work. AGENTS.md applies to any VIP schema/product change — do not add tables/columns not required to fix Orchestr8.

ALREADY ON MAIN (do not re-litigate)
- Open model catalog, custom roles, named councils, council chat + attachments
- Credit pause/resume (do not walk around billing failures)
- Empty OpenAI recovery for GPT-5.x / o-series (reasoning_effort=low, higher completion cap)
- Full Council honor selected team on Build Spec
- Anthropic omit/retry temperature on Claude 5.x (Architect 400)
- One-shot launcher starts the gateway

KNOWN GAPS (fix in priority order; skip anything already done)
1) Dogfood: document the exact Windows start + health check; any code change that makes "gateway offline / next not found / wrong cwd" less likely is in scope.
2) Provider request-shape: any remaining 400s (temperature, max_tokens vs max_completion_tokens, empty content) on OpenAI / Anthropic / Grok — fix adapters in orchestr8/providers/llm.py and retry rules in orchestr8/services/orchestrator.py. Tests without live keys.
3) Console: leftover custom teams must be usable; Build Spec must not silently drop a selected Full Council. Progress dock stall/hard-cap must allow a long council. Gateway step_start (backlog B) only if cheap.
4) Analysis tab: operator-verified inventory load + one SSE persist to Runs is still unchecked (backlog A). Fix blockers in code if you find them; do not invent Signals ingest unless required for a council to start.
5) Do not implement Phase O2 diff review, Viture, or new VIP product features.

CONSTRAINTS
- TypeScript + zod for new console contracts; Python + tests for gateway.
- No TCGplayer public API. No fake precision. Provenance on derived fields.
- Do not merge or force-push. Leave a short note: user / decision / evidence / action.
- If you cannot run the live gateway, change the repo and state the exact local verify commands.

OUTPUT
1) List of files you changed and why.
2) How to start Orchestr8 on Windows and confirm health.
3) What still blocks a successful Build Spec emit (honest).
4) Explicit: glasses are not started.
```
