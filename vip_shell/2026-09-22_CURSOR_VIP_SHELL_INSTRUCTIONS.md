# CURSOR BUILD INSTRUCTIONS — VIP Shell v1

**Plan file:** `2026-09-22_vip-shell-v1.iqvplan.json`
**Visual spec:** https://claude.ai/artifact/4D6o1DhSEANT4xbgEyhTiq
**Repo:** `D:\Projects\Business_Ideas\258_Labs\258_VIP`
**Branch:** create `cursor/vip-shell-v1` off `main`

Read the plan file first. It is authoritative for behavior. The canvas is authoritative for appearance.

---

## What you are building

A five-concept navigation shell — VAULT, INGEST, ADVISOR, SIGNALS, OPERATE — whose order and default landing come from role config. Plus the shared primitives, the design tokens, and the five route screens rendered from fixtures.

This replaces the current navigation. The old tabs do not survive as tabs; every capability becomes a view, a drawer, or a contextual action beneath one of the five.

## What you are NOT building

No live data. No OPERATE sub-pages. No search implementation. No mobile layouts. No Notion anything.

---

## Operating rules

**Run autonomously.** P0 through P9 without stopping for confirmation. The gates are pre-resolved.

**Five hard stops**, listed HS-1 to HS-5 in the plan. When one fires, stop that thread, write it into the report, and continue with independent work.

**One report at the end**, including what you would have done differently but did not because this plan forbade it.

---

## The three rules that carry the product

These are not styling preferences. Each one is a schema invariant showing up in the interface, and breaking one in the UI undoes a decision made in the database.

**1. There is no single price.** `ValueRange` has no prop for a scalar value. Every price renders as a range with comp count, recency, and a confidence word. When there are no comps it says so and offers an action. The database rule is that market price is always a time-series observation, never a stored current value — a UI that prints "$412" quietly reintroduces exactly what that rule exists to prevent.

**2. Uncertainty widens, it never hides.** Two comps at 61 days produces a visibly wider range than twelve comps at three days. Unverified condition renders a chip. The absence of a chip must mean verified, so never render one optimistically. `needs_review` is a permanent workflow state in the schema; the interface must never make it look resolved.

**3. Signals annotate valuations, they never become one.** No news-derived number may appear in a valuation slot. This is `may_raise_valuation_ceiling` expressed as a rendering rule.

---

## Role ordering

The five concepts are fixed. Their order and the default landing route are config.

A collector lands on VAULT. A dealer lands on OPERATE, because intake, pricing, and listing are their entire day, and browsing what they own is not the job. Same routes, same components, same code — different order, different landing.

No component may import the order array. It reads from role context. Write a test that fails if a literal order or a raw hex appears outside the config and token files, because this is the kind of rule that holds for three weeks and then quietly stops holding.

---

## Two states that are easy to treat as edge cases and are not

**"Not enough evidence to answer."** This is a designed answer state with working actions, styled caution rather than error. It is currently the honest response to any comics valuation question, since no comics price authority is connected. A system that refuses well is trusted when it does answer, so build this with the same care as the success path.

**A signal with no holdings linkage.** The "Why VIP cares" line assumes an entity layer that does not exist yet. The card must degrade to source lineage with a plain note. Get this right and SIGNALS can ship before the entity layer instead of waiting on it.

---

## The command palette

Build the component. Do not build search.

It opens, navigates by keyboard, renders grouped sections, and reports honestly that search is not connected. It never shows a fabricated result.

Unified search spans holdings, signals, transactions, and conversations — four stores with different identifiers — and needs the entity layer so one query resolves to one entity. Write the resolver interface, the result-type union, and the ranking contract as documentation, then stop. Designing it now fixes the header layout. Building it now blocks on work that does not exist.

---

## Definition of done

See the plan file. In short: five routes under three role configs, every required state rendered, no literal orders or raw hexes, palette honest about being unwired, fixtures only, ADR 0014 written.
