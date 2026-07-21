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
7. Feature freeze is ON. If a task isn't in the active milestone, refuse it
   and add it to docs/backlog.md under "Parked."

## Stack defaults (change only via an ADR)
- TypeScript everywhere. zod for schemas. Postgres. Drizzle/Prisma ORM.
- Next.js for web apps. Expo/React Native for mobile.
- Every package exports typed contracts; apps consume, never reach into DB directly.

## Existing proofs (do not rename casually)
Preserve these terms from the current SQL/parser proofs unless an ADR says otherwise:
`asset`, `holding`, `priced_unit`, `sale`, `market_value`, `collection_hunt`,
`external_id`, `assumed_grade` (as inferred · unverified, never as a fake grade).

## Definition of done for any task
- Types + zod schema first, then implementation, then tests.
- Provenance fields populated on any derived data.
- A short note in the PR body: user, decision, input evidence, output action.
