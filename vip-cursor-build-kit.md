# VIP — Cursor Build Kit

**Copy-paste prompts, repo structure, and a model-routing strategy to build the Vault Intelligence Platform in Cursor.**

Owner: Gregory Williamson · 258 Services · Prepared Jul 20 2026

---

## 0. How to use this kit

Each phase below has three things:
1. **A model pick** — which of your three models to use, and why.
2. **A "context primer"** — paste this into Cursor once per phase so the model knows the rules.
3. **Task prompts** — the actual instructions, in build order.

Cursor tip: keep `AGENTS.md` (below) at the repo root. Cursor reads it automatically, so every model inherits your frozen scope and provenance rules without you re-pasting them.

---

## 1. Model routing strategy

You named **Composer 2.5**, **Grok 4.6**, and an **Opus** model. Here's how I'd split the work — matched to what each does best, not one-size-fits-all.

| Job | Model | Why |
|---|---|---|
| Architecture, ADRs, schema design, "should this be one service or two?" | **Opus** | Deep reasoning + long context. This is where a wrong call costs you weeks — spend the smart model here. |
| High-volume in-editor code gen: components, adapters, CRUD, tests, refactors | **Composer 2.5** | Fast, cheap, made for agentic multi-file edits inside Cursor. Your daily driver. |
| Ambiguous research, "find me the API shape for X," rubber-duck debugging, quick spikes | **Grok 4.6** | Strong at open-ended reasoning and current-info tasks; good second opinion when Composer gets stuck. |
| The decision engine's rule logic + the agent contracts | **Opus** | This is your product's brain and your trust surface. Precision matters more than speed. |
| Prompt design for the Orchastr8 agents themselves | **Opus** → validated by **Grok** | Draft with Opus, red-team with Grok to catch overconfidence. |

**Rule of thumb:** Opus decides *what* and *why*. Composer builds *it*. Grok pressure-tests it.

Add each as a custom model in Cursor Settings → Models (via your own API keys where supported — this fits your BYOK plan for the Founder edition).

---

## 2. Repo structure (monorepo)

```
vip/
├─ AGENTS.md                 # frozen scope + rules — Cursor auto-reads this
├─ docs/
│  ├─ adr/                    # architecture decision records
│  │  └─ 0001-product-boundaries.md
│  ├─ entities-v0.1.md        # frozen canonical vocabulary
│  └─ backlog.md              # Now / Next / Later / Parked
├─ packages/
│  ├─ core-model/             # canonical entities, types, zod schemas
│  ├─ evidence/               # provenance, confidence, supersession
│  ├─ ingest/                 # source adapters (CLZ, TCG, …)
│  │  └─ adapters/
│  ├─ decision-engine/        # all-in cost, ranges, Buy/Watch/Pass rules
│  ├─ signals/                # ingestion, dedup, novelty, prediction ledger
│  └─ orchestr8/              # agent contracts + coordinator
├─ apps/
│  ├─ iqvault-web/            # collector app (Next.js/React)
│  ├─ iqvault-mobile/         # Show Mode (React Native / Expo)
│  └─ vaultos-web/            # LGS app — same backend, different constraints
├─ services/
│  ├─ api/                    # backend API over core-model
│  └─ jobs/                   # scheduled ingestion + run cadence
└─ infra/
   └─ db/                     # migrations, immutable snapshot store
```

Everything under `packages/` is shared intelligence. The `apps/` are just faces. This *is* Frozen Scope item F-01 expressed as folders — the structure itself prevents the product split.

---

## 3. `AGENTS.md` — paste this at repo root first

```markdown
# VIP Engineering Rules (Cursor: read before every task)

## What we're building
Vault Intelligence Platform: one shared backend + intelligence core.
IQVault (collector) and VaultOS (LGS) are role-specific faces on the SAME
services. Never fork backend logic between them.

## Non-negotiable rules
1. Decisions over inventory. Every feature ends in an action:
   Buy / Hold / Grade / Sell / Lot / Pass — with confidence + reasons.
2. Provenance is mandatory. Every derived field carries: source, method,
   model/rule version, confidence, verification status. Inferred values are
   NEVER stored as if verified. "NM assumed · unverified" > silent fill-in.
3. Raw imports are immutable. Keep source snapshots forever. Processed data
   is always regenerable from the snapshot.
4. No fake precision. Valuations are ranges + evidence count + recency +
   confidence. Never a single point value presented as fact.
5. Data sources are swappable adapters. No core logic depends on one scraper.
6. Agents obey contracts: mission, allowed tools, input/output schema,
   confidence rules, failure behavior, escalation. High-dollar recs get a
   critic pass.
7. Feature freeze is OFF (lifted 2026-08-02). Prefer Build Spec → Cursor for
   non-trivial work. Track remaining work in docs/backlog.md; do not refuse
   tasks solely for milestone/freeze reasons.

## Stack defaults (change only via an ADR)
- TypeScript everywhere. zod for schemas. Postgres. Drizzle/Prisma ORM.
- Next.js for web apps. Expo/React Native for mobile.
- Every package exports typed contracts; apps consume, never reach into DB directly.

## Definition of done for any task
- Types + zod schema first, then implementation, then tests.
- Provenance fields populated on any derived data.
- A short note in the PR body: user, decision, input evidence, output action.
```

---

## 4. Phase-by-phase prompts

### Phase 0 — Architecture baseline · **Model: Opus**

**Context primer (paste once):**
> You are the architect for VIP. Read AGENTS.md. Your job this phase is decisions and documents, not code. Optimize for boundaries that won't need re-cutting later. When unsure between one service and two, prefer one canonical service with role-based configuration.

**Prompts:**
1. `Write docs/adr/0001-product-boundaries.md. Define exactly what belongs to VIP (shared core), IQVault (collector face), VaultOS (LGS face), and Orchastr8 (agent layer). For each, list: owns / consumes / never touches. Include a decision table so any feature can be routed in under 5 minutes.`
2. `Write docs/entities-v0.1.md — freeze the canonical vocabulary. For each of these domains give: entity name, purpose, key fields, and identifier scheme. Domains: identity/tenancy, asset catalog, owned inventory, market evidence, signals/narratives, theses/predictions, recommendations, collections/hunts, transactions/workflow, media/grading, audit/provenance. No synonyms — one term per concept.`
3. `Write docs/backlog.md with four sections: Now, Next, Later, Parked. Populate Parked with: AI glasses, PSA→CGC/TAG crossover ML, full POS, marketplace automation, custom model training, all-categories-at-once. Put only Phase 0 items under Now.`
4. `Draft the MVP user journey in one sentence, then break it into the minimum sequence of backend capabilities it requires. Nothing else.`

---

### Phase 1 — Canonical data foundation · **Model: Composer 2.5** (schema review by **Opus**)

**Context primer:**
> Implement the entities from docs/entities-v0.1.md exactly. Types and zod schemas first. Provenance and immutability are load-bearing — build them into the base record, not as an afterthought.

**Prompts:**
1. `In packages/core-model, create TypeScript types + zod schemas for every entity in docs/entities-v0.1.md. Every record extends a BaseRecord that includes: id, createdAt, updatedAt, and a provenance block.`
2. `In packages/evidence, implement the provenance model: source, method (observed | normalized | inferred | opinion | recommendation), ruleOrModelVersion, confidence (0–1 or band), verificationStatus, supersededBy. Add helpers assertVerified() and markInferred().`
3. `In infra/db, write migrations for these entities in Postgres. Add a raw_snapshots table that stores original import payloads as immutable blobs with a hash. Nothing may UPDATE a snapshot row.`
4. `In packages/ingest/adapters, write a CLZ XML adapter. Parse the ~2,700-record comic export. Preserve every original field. Map 0.0 grades to {grade: null, inferred: "NM", verificationStatus: "unverified"} — never to a fake number. Write a second adapter stub for a TCG CSV export sharing the same Adapter interface.`
5. `Write a test that: imports a sample CLZ file, snapshots it, deletes all derived rows, regenerates them from the snapshot, and asserts the output is identical. This is the Phase 1 gate.`

---

### Phase 2 — Decision engine v0.1 · **Model: Opus** (bulk code by **Composer**)

**Context primer:**
> This is VIP's brain and its trust surface. Precision over speed. Every output is a range with an evidence count and confidence. Every recommendation cites at least one supporting and one opposing piece of evidence. No single-point valuations.

**Prompts:**
1. `In packages/decision-engine, implement: allInCost(item, context) including tax, premium, shipping, grading, expected selling fees; marketRange(asset) returning {low, high, matchedSales, recency, confidence}; liquidity(asset); targetPrice(asset, constraints).`
2. `Implement a rule engine that outputs one of Buy | Watch | Pass with: reasonCodes[], supportingEvidence[], opposingEvidence[], confidence. Rules must be configurable, not hardcoded magic numbers.`
3. `Add a UserConstraints type: budget, riskTolerance, timeHorizon, collectionGoals, premiumTolerance. Thread it through every recommendation so the same asset can yield different advice for different users.`
4. `Write the backtest harness: load 10 historical decisions (I'll supply a JSON fixture), run the engine, and produce a report comparing engine output to the actual decision + outcome. This is the Phase 2 gate.`

---

### Phase 3 — IQVault working app · **Model: Composer 2.5** (UX polish with the frontend-design mindset)

**Context primer:**
> Build the collector face on top of the shared packages. The app NEVER touches the DB directly — it goes through services/api. Recommendations always show evidence and confidence, never a bare number.

**Prompts:**
1. `In apps/iqvault-web (Next.js), build the inventory + portfolio dashboard reading from services/api. Show provenance/confidence badges on derived fields.`
2. `Build Signals, Watchlist, Theses, Sources, and Recommendations views backed by the canonical model.`
3. `Implement Collection Hunts as a reusable module. Seed it with the Absolute Batman hunt (issues 1–20 Cover A first prints, variants, printings, exclusives, grading targets, completion metrics) and the Pokémon master-set goals. Render an image-first Owned / Wanted / Missing gallery.`
4. `Build the comic sell queue view over the CLZ dataset: Museum / Investment / Liquidity scores, Sell Priority, Needs Grading / Photo / Verification flags, and recommendation labels.`

---

### Phase 4 — Automated intelligence runs · **Model: Composer** (agent prompts by **Opus**, red-team by **Grok**)

**Context primer:**
> No manual triggers. Ingestion runs on a schedule. Noise is quarantined and labeled, not deleted. Every run reports what CHANGED since the last run. Predictions are scored after expiry.

**Prompts:**
1. `In packages/signals, build the pipeline stages: SourceObservation → RawEvent → DeduplicatedEvent → NormalizedSignal → AssetImpact → ThesisUpdate → RecommendationChange. Store each stage; never overwrite.`
2. `Build a source registry: authority, historical accuracy, latency, category coverage, access method, terms.`
3. `Implement dedup (syndicated stories, repeated listings, recycled posts) and novelty scoring (new info vs repetition).`
4. `Build the prediction ledger: probability, evidence, action, expiration, outcome, Brier/calibration tracking, error notes. Add a calibration dashboard.`
5. `In services/jobs, schedule a zero-touch Pokémon drops run. Gate: it completes with no manual trigger and emits a "what changed" delta report.`

---

### Phase 5 — Mobile Show Mode · **Model: Composer 2.5**

**Context primer:**
> Field-first. Minimize taps, tolerate no signal. Output prioritizes action over analytics. Reuse the decision-engine package unchanged — the phone is a thin client over the same brain.

**Prompts:**
1. `In apps/iqvault-mobile (Expo), build a scan/photograph flow that captures an image + asking price and calls the decision engine.`
2. `Show: identified asset + alternates, all-in cost, credible comps + liquidity, collection fit, and a field action (Buy Now / Offer $X / Inspect / Watch / Pass) in ≤4 taps.`
3. `Implement offline-tolerant evidence capture with later sync. Gate: works in airplane mode, syncs cleanly on reconnect, scan→rec under 8 seconds.`

---

### Phase 6 — VaultOS pilot + grading capture · **Model: Opus** (boundaries) + **Composer** (build)

**Context primer:**
> VaultOS is the SAME engine with a store's utility function: max buy offer, margin, listing channel, inventory aging. Grading capture is a calibrated measurement system — store originals, calibration refs, metadata, and model version.

**Prompts:**
1. `In apps/vaultos-web, build: collection intake, buy-offer recommendation, expected margin, listing channel suggestion, inventory aging. Prove it calls the same decision-engine package as IQVault with store constraints swapped in.`
2. `Design the capture station data model: capture session, images, calibration references, preprocessing steps, model version. Store originals immutably. Build defect-annotation + grade-range estimate (crossover ML stays PARKED per F-scope).`

---

## 5. Cursor working habits

- **One phase per branch.** Don't let Composer wander across milestones — the freeze is enforced in `AGENTS.md`, but branches make it physical.
- **Ask Opus to review before merging Phase 0, 2, and 6.** Those are the expensive-to-undo phases.
- **Use Grok as your "am I fooling myself?" check** on any recommendation logic and any agent prompt. It's your built-in Critic/Red-Team seat until Orchastr8's critic agent exists.
- **Every PR answers five questions** (from AGENTS.md): user, decision, input evidence, output action, success metric. If a task can't answer them, it's probably scope creep.

---

*Build the intelligence loop. Prove the trust. Then expand.*
