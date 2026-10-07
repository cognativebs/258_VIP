# ADR 0014 — Shell navigation and role ordering

Status: accepted (2026-09-22)
Extends: ADR 0001 (one backend, role-specific faces)
Supersedes: none

## Context

IQVault shipped as a long tab bar: Portfolio, Collections, Comics, Scan, Intel, Sell, Signals, and the rest. Those tabs were a literal list in the header. A collector and a dealer do not share a day, but they share routes, components, and data rules.

Three of those rules have to show up in the interface or the schema decision is undone:

1. Market price is a time-series observation. A single number on screen puts back the scalar the database refuses to store.
2. `needs_review` is a permanent workflow state. Unverified condition is labeled. The absence of that label means verified.
3. A signal may annotate a valuation. It may not become one (`may_raise_valuation_ceiling`).

Unified search across holdings, signals, transactions, and conversations needs an entity layer those stores do not have. Designing the header around a palette is in scope. Building the index is not.

## Decision

1. The shell has five fixed concepts: VAULT, INGEST, ADVISOR, SIGNALS, OPERATE. Route paths are stable. Order and the default landing come from role config: collector and founder land on VAULT; dealer lands on OPERATE. Founder uses the collector order. Adding a role is a config entry. Components read role context. They do not import the order.
2. Values render as a range with comp count, recency, and a confidence word. No comps renders “No matched comps” and an Ask Advisor action. There is no scalar price prop.
3. OPERATE’s secondary nav (Sell, Listings, Transactions, Pricing, Catalogs, Integrations, Jobs) is role config. This pass renders navigable empty states only.
4. The command palette opens, moves by keyboard, and shows grouped sections. The resolver is a stub that returns no hits and the notice “Search is not connected yet.” The ranking contract and the entity-layer dependency are written in `apps/iqvault-web/src/shell/search/contract.ts`. They are not implemented.
5. Screens in this pass render from typed fixtures. Design tokens live in one file. A test fails if a concept order, the operate section order, or a raw color hex appears outside the role config and the token file.

## Consequences

- `/` follows the active role’s landing. Home is `/home`. The old portfolio remains at `/portfolio` and the old signals feed at `/signals-feed`. Neither is in the nav.
- Older collection, scan, and eBay pages are still reachable by URL. They are not tabs. Several of them still print point prices. That is pre-existing and out of this pass. New shell surfaces do not.
- Search, OPERATE workflows, and live vault or signal queries stay blocked on the entity layer, on sub-page work, and on Phase B pricing coverage.

## Alternatives rejected

- Hardcode the collector tab order and special-case the dealer. A new role would become a code change.
- Ship a blended search index before an entity id exists. The palette would invent joins.
- Show a news-derived number in a value slot “for context.” That number would be read as the price.
