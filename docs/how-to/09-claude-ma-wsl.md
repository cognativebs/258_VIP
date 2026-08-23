# Claude Managed Agent from WSL2

Operator runbook for the named Claude Managed Agent (MA) that finishes
Orchestr8. **Viture / XR glasses stay parked** until a Build Spec council
emits a critic-passed spec.

This machine is Anthropic's self-hosted environment
`env_01HgSHypqTtC6hNjRwYEucLs`, agent `agent_01B8ziCmNADfRwKexa969qQg`.
The worker already has the repo because **you placed it**. Anthropic will
not mount it.

## Find Skill.ai / Claude Platform Docs

| What | URL | Status (2026-08-23) |
|------|-----|---------------------|
| **skill.ai** | https://skill.ai | Homepage **503 / timeout**. Do not block on it. |
| Claude Platform — MA overview | https://platform.claude.com/docs/en/managed-agents/overview | Live |
| Claude Platform — quickstart | https://platform.claude.com/docs/en/managed-agents/quickstart | Live |
| Claude Platform — skills | https://platform.claude.com/docs/en/managed-agents/skills | Live |
| Claude Platform — self-hosted sandboxes | https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes | Live |
| Claude Platform — pricing (session runtime) | https://platform.claude.com/docs/en/about-claude/pricing | Live — `$0.08` / session-hour |
| Claude API skill (docs) | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/claude-api-skill | Live |
| Official Python MA skill | https://github.com/anthropics/skills/blob/main/skills/claude-api/python/managed-agents/README.md | Live |
| Agent Skills standard | https://agentskills.io | Live |
| Marketplace mirror of the same skill | https://github.com/aiskillstore/marketplace | Live copy of `anthropics/skills` |

Install the official skill locally (optional; this repo's session client
already follows the stream-first loop):

```bash
npx skills add https://github.com/anthropics/skills --skill claude-api
```

Claude Code: `/claude-api` or `/claude-api managed-agents-onboard`.

---

## Step 0 — Prereqs (WSL2)

```bash
python3 --version          # 3.10+ is enough for the session client; Node 22+ if you also run the console from WSL
pip install anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
```

Use a **rotated** key. Do not paste the key into chat, git, or `orchestr8/.env`
as a substitute for this export. Gateway keys stay in `orchestr8/.env`.
The MA **client** reads `ANTHROPIC_API_KEY` from this shell.

### Two things to know going in

1. **Session runtime bills $0.08 per session-hour while `running`**, on top of
   normal token usage. Metered to the millisecond. Time in `idle`,
   `rescheduling`, or `terminated` is not billed.
   Source: [Claude Platform pricing — Managed Agents](https://platform.claude.com/docs/en/about-claude/pricing).
2. **Self-hosted environments reject `file` and `github_repository` resources
   with HTTP 400.** Anthropic will not mount your repo. You place it yourself
   (already done). The only `resources` type self-hosted accepts is
   `memory_store`. Pass paths in session `metadata` if the agent needs a hint;
   `apps/managed-agent-session/session_chat.py` does that and never sends
   `file` / `github_repository`.
   Source: [Self-hosted sandboxes — Provide files](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes).

Beta header `managed-agents-2026-04-01` is set by the Python SDK on
`client.beta.sessions.*`. Do **not** call `agents.create` on the hot path —
reuse `agent_01B8ziCmNADfRwKexa969qQg`.

---

## Step 1 — Repo placement

Leave Orchestr8 on the Windows drive. **Do not copy it into the WSL
ext4 filesystem** (`~/orchestr8`, `/home/...`, `/opt/...`).

| Side | Path |
|------|------|
| Windows | `C:\258Labs\orchestr8` |
| WSL2 | `/mnt/c/258Labs/orchestr8` |

You take an I/O hit across the 9p mount. You get one source of truth, and
Windows can still run `Launch IQVault.bat` / `start_orchestr8.bat`. For a
repo-reading MA task that is the right trade.

```bash
cd /mnt/c/258Labs/orchestr8
# expect apps/managed-agent-session/session_chat.py at this root
```

MA cannot see `127.0.0.1:5210` on the Windows host. Local verify of the
gateway is still a **Windows** step after MA edits the tree.

---

## Send the Orchestr8 mission

From WSL2, after Step 0:

```bash
cd /mnt/c/258Labs/orchestr8
python3 apps/managed-agent-session/session_chat.py \
  --file docs/prompts/2026-08-23_claude_ma_finish_orchestr8.md
```

(`--file` sends only the fenced `MISSION` block.)

Windows PowerShell equivalent (same tree, no copy):

```powershell
Set-Location "C:\258Labs\orchestr8"
$env:ANTHROPIC_API_KEY = 'sk-ant-...rotated...'
python apps\managed-agent-session\session_chat.py --file docs\prompts\2026-08-23_claude_ma_finish_orchestr8.md
```

Historical VIP checkout `D:\Projects\Business_Ideas\258_Labs\258_VIP` is
**not** the MA working tree. Do not run the client from
`C:\Users\Greg_Admin` — wrong cwd.

## Local verify after MA edits (Windows)

Keys only in `orchestr8/.env`. Then:

```powershell
Set-Location "C:\258Labs\orchestr8"
.\start_orchestr8.bat
# second window:
npm run orchestr8:console
Invoke-RestMethod http://127.0.0.1:5210/v1/health
```

Success is a critic-passed Build Spec under `docs/specs/`, not a glasses app.
