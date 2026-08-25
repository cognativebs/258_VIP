# How-To: Choose Orchestr8 councils and get graded feedback

**Start from:** Orchestr8 Console → http://127.0.0.1:3001  
Gateway: http://127.0.0.1:5210 · keys in `orchestr8/.env` only.

## Mental model

- **Council** = fixed team + procedure (who speaks, pipeline vs parallel, veto rules).
- **Preset / Custom** = which roles you pick in the Team panel (can override or match a council).
- **Task** = playbook prompt injected into the run (`build_spec`, `comics_collection_analysis`, …).
- **Autonomy 0 (ADR 0003):** Orchestr8 **authors** build specs; **Cursor builds**. Agents do not write/execute in-repo code.

Open **AI team** (top bar) to pick Solo / Duo / Council / Custom and per-role models.

## Council cheat sheet

| Council | Use when | Mode / gate | Output owner |
|---------|----------|-------------|--------------|
| **Build Spec** | New VIP features → Cursor work order | Pipeline; **veto on critical** | Critic |
| **Analysis** | Price / ROI / liquidity / portfolio on inventory context | Parallel | Investment analyst |
| **Curation** | Pillars, grading advice, thesis, sell timing | Parallel | Collection curator |
| **Discovery** | Hunts, signals, acquisition leads | Parallel | Researcher |
| **Challenge** | Stress-test a recommendation or pasted diff | Pipeline; **veto on critical** | Critic |
| **Execution** | Turn a decision into a plan / narrative | Pipeline | Synthesizer |
| **Board** | High-stakes; force dissent | Parallel; high_stakes gate | Synthesizer |
| **Comics VIP** (preset, not a YAML council) | Comics research → price/LIQ → critic → synthesize | Pipeline roles | (preset) |

Full YAML: [`orchestr8/config/councils.yaml`](../../orchestr8/config/councils.yaml). Live list: `GET /v1/councils`.

---

## 1) Building new features for VIP

**Council:** Build Spec  
**Tab:** Build Spec  
**Team:** preset **Build Spec Council** (or leave defaults on that tab)

Steps:

1. Open Console → **Build Spec**.
2. Write a backlog-sized goal (one feature, schemas-first, acceptance tests).
3. Attach reference files (upload `.md` / `.json` / `.txt` / …) and/or list **repo paths**
   (one per line). Those go into the run as `operatorAttachments` — the council can
   read them. There is no mid-run file chat; attach before Run.
4. Run **Run Build Spec Council**.
5. Watch the **Council chat** (expand a bubble or **Expand all**) and the Progress dock.
   Critic questions appear after the run — not mid-run. Use **Insert council
   questions into goal**, fill answers, then **Revise from veto (1×)** if vetoed.
6. Outcomes:
   - **VETOED** — click **Revise from veto (1×)** (loads Critic notes into the goal). Review, then Run once. If still blocked → park or fill by hand — **no second revision loop**.
   - **emit / path under `docs/specs/`** — **Copy .md / JSON / Cursor prompt** from the chat or Specs tab, then paste `cursor_prompt` into Cursor and build.
7. Optional second pass: Team → **Challenge Council**, paste the implemented diff + acceptance criteria (Phase O2).

**Credit / billing pause:** if a provider rejects a role for quota, prepaid balance, or HTTP 402, the council **stops**. Later roles are not called. A detailed alert names the role, provider, model, exact error, spend so far, and which steps are kept. Top up that provider, then **Resume after top-off**. Resume retries only the failed role, then the remaining ones — completed calls are not re-run. The paused bundle is under **Runs** as `PAUSED`.

**Veto revision budget:** at most one paid council pass after a veto per source run. Approving the Critic’s catch is good; endless “improve the spec” rounds are not.

**What “graded feedback” looks like:** Critic verdict, veto summary, cost, `runId` under **Runs**, and the written spec JSON/Markdown.

---

## 2) Analytics of comic inventory + market advice

**Council:** Analysis (default) or preset **Comics VIP slice**  
**Tab:** **Analysis**

Steps:

1. Start VIP API (`:8787`) for platform inventory + comps. Comics API (`:5200`) is fallback if VIP is down.
2. Console → **Analysis** → Reload inventory (source pill shows VIP vs Comics). Wait for the **comps** pill (adapter evidence on the top holdings, cap 12).
3. Pick a **slice** (e.g. Sell priority High).
4. Ask a decision question (“If I need $500 this month, which 5 books…?”).
5. Run **Run Collection Analysis**. Context includes per-highlight `market` (range, matchedSales, recencyDays, provenance). Catalog dollars stay labeled unverified.
6. Read each specialist step + final text. Expect **ranges / confidence / gaps**. Critic **should veto Sell/Lot** when adapters are idle or matchedSales < 3 — that is correct, not a bug. Set `EBAY_OAUTH_TOKEN` (and TCG ids for cards) when you want live comps.
7. For expensive calls: switch Team to **Challenge Council** and paste the Analysis answer for a veto pass.
8. Optional: **Curation Council** (Custom roles or when exposed) for pillar / grade / sell-timing framing.

**Task under the hood:** `comics_collection_analysis` (see `orchestr8/config/roles.yaml` `task_systems`).

---

## 3) Building, deleting, or modifying Agent Roles / Skills

Orchestr8 does **not** give agents a “delete yourself” tool. Agents never author
roles — you do, either from the Console (quick, unverified) or through a Build
Spec that Cursor implements (reviewed, permanent).

### Understand what exists

| Layer | Location |
|-------|----------|
| Councils | `orchestr8/config/councils.yaml` |
| Agent cards | `orchestr8/agents/<id>/agent.yaml` + `contract.yaml` |
| Skills (long form) | `orchestr8/AI_Agent_Production_Skills_v2/` (and Skills_MD_v2) |
| Models / providers | `orchestr8/config/models.yaml`, `orchestr8/.env` |
| Console presets | `apps/orchestr8-console/src/lib/roles.ts` |

List live agents: Console Team panel, or `GET /v1/agents`.

### Recommended workflow (graded)

1. Team → **Build Spec Council**.
2. Goal examples:
   - “Add agent role `reprint_scout` with contract v2, Discovery Council membership, skill MD, and Console preset.”
   - “Retire / remove role X: drop from councils, archive skill, update Console presets, keep run history.”
   - “Tighten Critic skill: require evidence count before approving high-dollar Sell.”
3. Run council → accept only a **non-vetoed** spec with file plan + acceptance tests.
4. Implement in Cursor (edit YAML/MD/presets; run `validate_contracts.py` if contracts change).
5. `POST /v1/reload` or restart gateway so registry picks up agents.
6. Optional **Challenge** pass on the diff vs the spec.

### Create a role from the Console (unverified)

Team → **New role** → Name, Short description, Skills → **Create role**. The card
appears immediately and is ticked into your current custom team.

What the gateway derives for you, and why:

| Derived | Value |
|---------|-------|
| Agent id | slug of the name (`Reprint Scout` → `reprint_scout`); refuses to shadow a built-in or legacy alias |
| Contract | auto-generated, **no tools**, `degrade` on failure, escalates to human below 0.5 confidence |
| Model | head of the first fallback chain whose provider has a key — change it on the card |
| Provenance | `source: console_ui`, `verification_status: unverified` |

Limits worth knowing before you rely on one:

- Roles are written to `orchestr8/custom_agents/`, which is **gitignored** — local
  to this machine, like `.runs/`. They survive restarts, not a fresh clone.
- They are **not council members**. Run them via **Custom roles**.
- They are badged `custom · unverified` because no council reviewed them. Treat
  their output accordingly, and put a Critic in the team for anything that costs money.
- **Edit** on any card (shipped or custom) opens name, description and skills.
  The id never changes. Shipped roles are copied into `custom_agents/<id>/` so
  git-tracked files stay clean; delete that folder to revert. Custom roles are
  rewritten in place.
- No delete in the UI yet. Delete the folder under `custom_agents/<id>/` and
  `POST /v1/reload`.

To make one permanent and reviewed, promote it: run a Build Spec for it (below),
then move the files into `agents/<id>/` so it ships with the repo.

### Custom team without editing YAML

Tick roles → **Save team** → name the council. That writes `orchestr8/custom_councils/<id>/`
(gitignored, like custom roles) and adds a **Councils** button with **Edit** / **Delete**.
Shipped YAML councils stay read-only. Saved teams are `custom · unverified` — they
run with voting `none` unless you change that later in the YAML.

For a one-off you can still tick roles and run without saving. Permanent reviewed
playbooks belong in `orchestr8/config/councils.yaml`.

---

## Feedback quality checklist

Before you trust a run:

- [ ] Right **council** for the job (build vs analyze vs challenge)
- [ ] Right **context** (Analysis tab inventory / Build Spec goal text)
- [ ] Critic / veto not skipped on money or scope-creep features
- [ ] Run visible under **Runs** with cost (readable summary; not only raw JSON)
- [ ] Spec under **Specs** / `docs/specs/` when building features
- [ ] Providers green on health: `GET /v1/health` → openai / anthropic / grok

**Note (2026-08-02):** Feature freeze / milestone gates are **OFF** (ADR 0004). Critic should not veto solely for “not in Now.” Remaining work lives in [`docs/backlog.md`](../backlog.md).

## Provider note

`/v1/health` `providers: true` means **API keys present** for chat.  
`/v1/accounts` admin spend keys are separate (`OPENAI_ADMIN_KEY`, etc.) and may show unavailable even when chat works.
