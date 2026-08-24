# Orchestr8 v1.01 — release-candidate status ledger

Living handoff doc. **Read this before re-auditing.** Sessions are ephemeral;
this file is the memory. Update it at the end of every session.

- Repo root (workstation): `D:\Projects\Business_Ideas\258_Labs\258_VIP`
- Environment: `env_01D8Du4whd8zzNbZe5TGG2Vs` (`o8-workstation`, self-hosted)
- Branch: `cursor/ma-finish-orchestr8-058c`
- Last updated: 2026-08-23
- Structural map of the gateway/console: [`PATHMAP.md`](../PATHMAP.md) (still accurate)

Claim labels used below: **FACT** = observed on this machine this session.
**INFERENCE** = reasoned from code that was read. **UNKNOWN** = not verified.

---

## 1. Environment facts worth not rediscovering

| Thing | Status |
|-------|--------|
| Repo root is the VIP monorepo; gateway `orchestr8/`, console `apps/orchestr8-console/` | FACT |
| Worktree is **CRLF**, git index/HEAD is **LF**, no `.gitattributes`, `core.autocrlf` unset | FACT |
| ⇒ `git status` shows ~every file modified. That is line-ending noise, not work. | FACT |
| ⇒ Use `git diff --ignore-cr-at-eol` to see real changes. Stage files **by explicit path**. | FACT |
| WSL side has Python 3.12 but **no pip/ensurepip/pytest**; `pyyaml` only | FACT |
| Working test setup: `python3 -m venv --without-pip /tmp/o8venv` + `get-pip.py` + `pip install pytest pyyaml python-dotenv` | FACT |
| Windows interop: `npm` works; `python.exe` under `/mnt/c/...` did **not** exec | FACT |
| Node is not installed Linux-side; `npm run typecheck` works through the Windows shim | FACT |
| `next` is hoisted to the **root** `node_modules`; console `node_modules` is empty and that is normal | FACT |

## 2. Verified this session (evidence, not claims)

| Check | Result |
|-------|--------|
| `python -m pytest tests -q` | **134 passed, 5 skipped** on the workstation *with real keys present* |
| `npm run typecheck -w @vip/orchestr8-console` | **exit 0** |
| Gateway boots, `GET /v1/health` | `{"ok":true,"service":"orchestr8","providers":{openai,anthropic,grok all true}}` (port 5211) |
| Startup banner reaches a redirected log | yes, after `sys.stdout.reconfigure(line_buffering=True)` |
| Port-in-use path | prints `Bind failed…` + `netstat`/`taskkill` hint, exits 1 |
| SSE heartbeat on `/v1/jobs/stream` | 78 heartbeat frames in one run; **85/85 frames parsed as valid JSON** (no interleaving) |
| Stale role id in roster | dropped and reported; council still runs |

Spend note: the SSE and stale-role probes used **deliberately invalid API keys**,
so all provider calls returned auth errors. **No tokens were purchased.**

## 3. Known gaps — current state

### Gap 1 — Dogfood start + health · **DONE (code + docs)**
- New runbook: [`how-to/09-orchestr8-dogfood-start.md`](how-to/09-orchestr8-dogfood-start.md).
  Exact Windows start for gateway + console, health check, failure table.
- `server.py`: bind-failure now explains the stale-listener case instead of a
  bare traceback; stdout is line-buffered so launcher logs are not empty;
  startup warns when `orchestr8/.env` is absent.
- **Root cause found + fixed:** importing `services/provider_env.py` called
  `load_dotenv()` unconditionally, injecting the operator's **real** keys into
  `os.environ`. The suite was therefore *not* hermetic on the workstation —
  `test_default_model_prefers_a_provider_that_has_a_key` passed in CI and failed
  here. Now gated by `ORCHESTR8_SKIP_DOTENV`, which `tests/conftest.py` sets.
  Gateway runtime behaviour is unchanged.

### Gap 2 — Provider request-shape · **mostly done**
- `llm.py`: `_canonical_model` strips vendor prefixes (`openai/gpt-5.4`);
  reasoning detection widened to `o\d` / `gpt-5` / `gpt-[6-9]`;
  `_repair_openai_body` does a one-shot 400 repair (`max_tokens` →
  `max_completion_tokens`, drop `temperature`); Grok gained the
  temperature-rejected retry and the empty-content retry that OpenAI already had;
  `URLError` is wrapped so it is retryable.
- Covered by `tests/test_orchestr8_model_catalog.py` and
  `tests/test_orchestr8_build_spec_gates.py`, no live keys.
- **UNKNOWN:** no live 400 has been reproduced against a real provider this
  session. The repairs are unit-tested, not field-tested.

### Gap 3 — Console / roster · **done except the two below**
- Build Spec no longer downgrades a selected Full Council:
  `council: roster.councilId || "build_spec"` (`BuildSpecPanel.tsx`).
- `build_spec` task now phase-sorts roles so **Architect authors before Critic
  reviews** (`order_build_spec_roles`). The global `pipeline_order` and the Full
  Council YAML both list `critic` before `architect`, which previously produced a
  "critic_passed" spec that Critic had never actually seen.
- `provenance.verification_status` is only `critic_passed` when
  `critic_review == "post_author"`. New field: `provenance.critic_review`.
- **Leftover team fix (this session):** a saved console team can name a custom
  role that has since been deleted (backlog B explicitly tells operators to
  delete `custom_agents/<id>/` by hand). One stale id raised
  `ValueError: Unknown agent` out of `_build_system` and **killed the entire
  council**. Now `_drop_unknown_roles` filters them, the run continues, and the
  ids come back as `result.droppedRoles`. All-stale falls back to the council
  roster; all-stale with no council raises an actionable message.
- **Progress dock / stall:** the console watchdog fires after **10 min of SSE
  silence**, but one role can legitimately be silent far longer (socket timeout
  scales to 480 s and `_chat_role_retry` adds a second attempt). Fixed
  gateway-side: `/v1/jobs/stream` emits `{"type":"progress","phase":"heartbeat"}`
  every 20 s (`SSE_HEARTBEAT_SECONDS`). Silence now means the gateway actually
  died, so the watchdog is accurate. **No console change was needed** — the
  heartbeat carries no `message`/`role`, and `onProgress` already keeps the
  previous text while bumping `lastActivityAt`.
  Hard cap is `max(20 min, roles × 8 min)` = **176 min for a 22-role Full
  Council**; `roles` is populated at run start, so this is adequate. Not changed.
- **Still open:** backlog B `step_start` events. The heartbeat covers the
  "is it alive" half; a true `step_start` (role announced before the model call)
  is still not emitted. `progress(phase="role_start")` already exists and is
  close — worth checking whether the dock can just use it.

### Gap 4 — Analysis tab · **NOT DONE, and not verifiable from here**
- Backlog A gate "Analysis tab loads inventory + one SSE run persists to Runs
  (operator-verified)" is still unchecked.
- It needs the Comics API `:5200` **or** VIP API `:8787` up, which needs Docker +
  Postgres + the CLZ import. None of that was started this session.
- No code blocker was found by reading; the gate is an **operator** verification.
  Do not invent a Signals ingest for it (explicitly out of scope).

### Out of scope — do not start
Phase O2 diff review · Viture / XR glasses / Luma Ultra · new VIP product
features · any schema/table change not required to fix Orchestr8.

## 4. What still blocks a clean Build Spec emit

1. **No live end-to-end run has been done.** Everything above is unit-verified or
   verified with invalid keys. The first real council is still the proof.
2. **Emit depends on Architect producing parseable spec JSON.** If Architect
   fails or returns prose, `_emit_build_spec` skips and writes
   `buildSpecStatus: emit_failed: …`. That is the single most likely reason for
   "council ran, no file in `docs/specs/`". The gateway window prints the reason.
3. **`critic_passed` is now strict.** A roster without Critic, or with Critic
   before Architect, yields `unverified`. For Full Council the phase sort handles
   it; for a hand-picked team the operator must include Critic.
4. Provider 400 repairs are **unit-tested only** (see Gap 2 UNKNOWN).

## 5. Next session — start here

1. Read this file and `PATHMAP.md`. Do not re-audit the tree.
2. Rebuild the venv (§1) — `/tmp` does not survive.
3. `python -m pytest tests -q` should be **134 passed, 5 skipped**. If a
   provider-selection test fails, check `ORCHESTR8_SKIP_DOTENV` is still set in
   `tests/conftest.py` before touching anything else.
4. Run one **live** Build Spec council (Gap 2/§4 item 1) and record what happened
   here — that is the highest-value remaining action.
5. Then Gap 4's operator gate, then backlog B `step_start`.
