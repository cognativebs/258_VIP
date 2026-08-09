# ADR 0008 — Ricoh fi-8170 scan intake via `@vip/scan-ingest`

**Status:** Accepted  
**Date:** 2026-08-09  
**Owner:** Gregory Williamson / 258 Services  
**Related:** ADR 0001 (imaging station → VIP media model), ADR 0006 (do not resurrect CLZ `packages/ingest`)

## Context

Sports cards and TCG need a bulk ADF intake path. Hardware on hand is a
**Ricoh fi-8170** (PaperStream Capture → folder drop / duplex JPEG/TIFF).
Phase 6 capture entities (`CaptureSession`, `CaptureImage`) already exist in
`@vip/core-model` but had no runtime pipeline. Marketplace listing automation
remains deferred until eBay developer tokens exist.

ADR 0006 removed `packages/ingest` because it duplicated Python CLZ. That
decision does **not** forbid a new TypeScript package for image/scan intake.

## Decision

1. Add **`packages/scan-ingest` (`@vip/scan-ingest`)** as the typed contract +
   pipeline for card scan intake (sports + Pokémon + MTG first).
2. Device input is a **swappable adapter**. v0 is `FolderWatchAdapter`
   (PaperStream drop). Hardware SDK / SANE can replace it without forking
   inventory logic.
3. Pipeline stages:
   - duplex page pair → immutable snapshot descriptors
   - ID candidates (**inferred · unverified**)
   - **duplicate alert** (operator must acknowledge before adding a copy)
   - confirm → inventory **Hold** with `source = ricoh_fi8170`
   - optional **eBay listing draft** (idle without tokens; never auto-submit)
4. Quality tier is **`intake`** now. Museum-quality capture is a later path that
   reuses the same `CaptureSession` / `CaptureImage` model with
   `quality_tier = museum`.
5. Persist media rows via migration
   `infra/db/migrations/20260809_03_capture_session.sql`. API may use an
   in-memory `ScanSessionStore` for dogfood until write-through is wired.
6. VIP API surface: `GET/POST /api/scan/*` on `@vip/api` (shared brain; faces
   consume, never fork).

## Consequences

- Condition after intake is **`NM assumed · unverified`** — never a fake grade.
- eBay sold comps (`ebay-sold` adapter) stay separate from listing-out drafts.
- CLZ Python path unchanged. New importer registers `source` tags only.
- UI for the review queue can land in IQVault or VaultOS later; contracts ship first.
