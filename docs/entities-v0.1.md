# VIP Canonical Entities — v0.1 (Frozen Vocabulary)

**Status:** Frozen for Phase 0 gate  
**Date:** 2026-07-20  
**Rule:** One term per concept. No synonyms in new code. Legacy UI labels may display differently but must map here.

Every persisted record will eventually extend a **BaseRecord**: `id`, `createdAt`, `updatedAt`, `provenance` (see Evidence domain). Phase 1 implements types/zod; this doc freezes names only.

---

## 1. Identity / Tenancy

| Entity | Purpose | Key fields | Identifier |
|---|---|---|---|
| **Tool** | Product surface (IQVault, VaultOS, Orchastr8) | `code`, `displayName` | `tool.code` (stable string) |
| **ToolUser** | User account within a tool | `toolId`, `handle`, auth refs | UUID |
| **AccountLink** | Links the same human across tools | `fromUserId`, `toUserId`, status | UUID |
| **Tenant** *(new name; not yet in SQL)* | Ownership boundary for inventory & decisions | `type` (`personal` \| `store`), display name | UUID |

*Preserve from `06_platform_auth.sql`: `tool`, `tool_user`, `account_link`, `sync_event`. Do not invent parallel “User” vs “ToolUser” without an ADR.*

---

## 2. Asset Catalog

| Entity | Purpose | Key fields | Identifier |
|---|---|---|---|
| **Category** | Vertical pillar | `kind` (`pokemon` \| `sports` \| `mtg` \| `comic` \| `other`) | smallint + kind |
| **Asset** | One uniquely identifiable collectible “thing” in the catalog | `categoryId`, `format`, `canonicalName`, `slug`, `baseAssetId`, `releaseYear`, `tags` | UUID (`asset.id`) |
| **ExternalId** | Map Asset → outside systems | `assetId`, `source`, `externalValue`, `url`, `confidence` | unique `(source, externalValue)` |
| **Entity** / **AssetEntity** | People/characters/IP linked to assets | name, role on asset | UUID |
| **GradeCompany** / **GradeScale** | Unified grading axis | company code, label, `normalizedScore` | smallint / int |
| **PricedUnit** | Asset at a specific grade (the priced thing) | `assetId`, `gradeScaleId` | UUID; unique `(assetId, gradeScaleId)` |

**Category extensions** (not synonyms of Asset): comic `Series` → `Issue` → variant/printing as Assets; TCG `Set` / `Card`; sports product / parallel ladder. Detail tables reference `asset_id`.

*Preserve spine from `01_core_spine.sql`, `02_tcg.sql`, `03_sports_comics.sql`, `04_market_sealed_id.sql`.*

---

## 3. Owned Inventory

| Entity | Purpose | Key fields | Identifier |
|---|---|---|---|
| **Holding** | Owned copy-group (not catalog identity) | `assetId`, `quantity`, cost/date, location, slab/grade fields, decision-intel columns (derived), `source`, `sourceRowId` | UUID; unique `(source, sourceRowId)` for import sync |

**Rules:** Catalog identity lives on **Asset**. Ownership + collector intel live on **Holding**. Never call a Holding an “Asset” in APIs.

*Grade 0.0 / raw:* store `gradeRating = null`, inference `assumedGrade = "NM"` with `verificationStatus = unverified` — never a fake numeric grade. Aligns with today’s “NM assumed” instinct in `clz_comic_parser.py` / `holding.assumed_grade`.

---

## 4. Market Evidence

| Entity | Purpose | Key fields | Identifier |
|---|---|---|---|
| **Sale** | Observed transaction | `pricedUnitId`, `source`, `sourceListingId`, price, shipping, date, `confidence`, `rawTitle`, outlier flags | bigserial; unique `(source, sourceListingId)` |
| **MarketValue** | Normalized rolling valuation | `low`, `high`, `marketPrice` *(internal blend — UI shows range)*, `sampleSize`, `windowDays`, velocity, liquidity, `computedAt` | PK = `pricedUnitId` |
| **MarketValueHistory** | Point-in-time marks | price, sample, `asOf` | `(pricedUnitId, asOf)` |
| **PopulationReport** | Supply-side pop counts | company, grade label, counts, `asOf` | composite unique |

**UI rule:** Never present `marketPrice` alone as fact. Surfaces show **range + sampleSize + recency + confidence**.

---

## 5. Signals / Narratives

| Entity | Purpose | Key fields | Identifier |
|---|---|---|---|
| **SourceObservation** *(Phase 4)* | Raw pull from a registered source | source, payload ref, fetchedAt | UUID |
| **Signal** | Normalized, durable market/news/supply event | `signalType`, body, `sourceUrl`, dates, novelty, quarantine status | UUID |
| **HuntSignal** | Signal scoped to a CollectionHunt (current SQL) | `huntId`, type, body, url, date | UUID |

*Vocabulary lock:* **Signal** = persisted intelligence event. Orchastr8 “Signal Hunter” is an **agent role**, not an entity name.

---

## 6. Theses / Predictions

| Entity | Purpose | Key fields | Identifier |
|---|---|---|---|
| **Thesis** | Stated belief about an asset/set/theme | claim, horizon, linked assets, status | UUID |
| **Prediction** | Scorable forecast | probability, evidence refs, action, `expiresAt`, outcome, calibration notes | UUID |

*Today:* mostly Orchastr8 / Pokémon run docs — not yet first-class SQL. Names freeze now; tables in Phase 4.

---

## 7. Recommendations / Decisions

| Entity | Purpose | Key fields | Identifier |
|---|---|---|---|
| **Recommendation** | Engine or agent output proposing an action | `action`, `reasonCodes[]`, supporting/opposing evidence refs, `confidence`, constraints snapshot, rule/model version | UUID |
| **Decision** | User-accepted (or overridden) action + outcome | links Recommendation, chosen action, evidence bundle, outcome, decidedAt | UUID |

**Canonical actions (VIP):** `Buy` \| `Hold` \| `Grade` \| `Sell` \| `Lot` \| `Pass`  
*(Phase 2 engine may use `Watch` as a Hold subtype / reason code — not a second vocabulary.)*

**Legacy labels → reason codes / UI gloss (not new actions):**  
`Museum Candidate`, `Investment Hold / Review`, `Sell Duplicate`, `Sell / Lot Candidate`, `Verify then Lot`, `Inventory Review`, demo `avoid`.

---

## 8. Collections / Hunts

| Entity | Purpose | Key fields | Identifier |
|---|---|---|---|
| **CollectionHunt** | Guided completion goal | slug, name, category, status, budget, completion metrics, config | UUID / slug |
| **HuntSection** | Grouping within a hunt | slug, name, sort | UUID |
| **HuntItem** | Wanted / owned / missing line | `assetId?`, status (`owned` \| `wanted` \| `missing`), targets (`buyUnder`, grade), metrics | UUID |

*Preserve from `05_collection_hunts.sql`. Absolute Batman + Pokémon master-set are instances, not entity types.*

---

## 9. Transactions / Workflow

| Entity | Purpose | Key fields | Identifier |
|---|---|---|---|
| **SyncEvent** | Cross-tool sync / link audit | tool users, payload, status | UUID |
| **WorkflowRun** *(Phase 4+)* | Scheduled intelligence or ingest job | kind, started/finished, delta summary | UUID |
| **BuyOffer** *(VaultOS)* | Store-facing offer presentation | max offer, margin expectation, channel — **derived from Recommendation**, not a second engine | UUID |

---

## 10. Media / Grading Capture

| Entity | Purpose | Key fields | Identifier |
|---|---|---|---|
| **IdObservation** | Human/model ID attempt | asset hypothesis, confidence, raw cues | from `04_market_sealed_id.sql` |
| **CaptureSession** *(Phase 6)* | Controlled imaging session | calibration refs, device, model version, purpose, qualityTier (`intake` \| `museum`) | UUID |
| **CaptureImage** | Immutable original media | sessionId, hash, face (front/back), qualityTier, preprocessing steps | UUID + content hash |
| **ScanBatch / ScanUnit** *(ADR 0008)* | Ricoh/ADF intake review queue | duplex pair, ID candidates, duplicate alert, confirm → Holding | UUID |

Crossover ML (PSA→CGC/TAG) stays **Parked**; capture stores measurement provenance only.

---

## 11. Audit / Provenance

| Entity / block | Purpose | Key fields | Identifier |
|---|---|---|---|
| **Provenance** (block on every derived record) | Trust metadata | `source`, `method` (`observed` \| `normalized` \| `inferred` \| `opinion` \| `recommendation`), `ruleOrModelVersion`, `confidence`, `verificationStatus`, `supersededBy` | embedded or row id |
| **RawSnapshot** | Immutable import payload | `source`, `contentHash`, blob/ref, `ingestedAt` — **no UPDATE** | UUID / hash |
| **HoldingClzMetadata** *(legacy)* | Current CLZ JSON on holding | migrate toward RawSnapshot + regenerable derived fields | FK to holding |

---

## Vocabulary check (Phase 0 gate)

- **Asset** ≠ **Holding**
- **Signal** (data) ≠ Signal Hunter (agent)
- **MarketValue.marketPrice** is internal; UX speaks in **ranges**
- **Recommendation** proposes; **Decision** records what the user did + outcome
- No second word for Asset (`item`, `sku`, `collectible`) in APIs — use Asset / PricedUnit / Holding precisely

## Legacy SQL schemas (reference, not synonym)

| Schema | Role |
|---|---|
| `vault_core` | Catalog spine |
| `vault_market` | Sales, values, pop, sealed, ID |
| `vault_hunt` | Collection hunts |
| `vault_platform` | Tools, users, sync |
| `vault_collection` | Holdings + CLZ metadata |
