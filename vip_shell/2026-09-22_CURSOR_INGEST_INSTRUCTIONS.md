# CURSOR BUILD INSTRUCTIONS — INGEST v1

**Plan file:** `2026-09-22_vip-ingest-v1.iqvplan.json`
**Repo:** `D:\Projects\Business_Ideas\258_Labs\258_VIP`
**Branch:** `cursor/vip-ingest-v1`, off `cursor/vip-shell-v1`

Read the plan file first. It is authoritative.

---

## What you are building

INGEST as three decisions in order: **where** the inventory goes, **how** it arrives, **which** batch it belongs to. Then a working capture path for barcode scanning, a real batch lifecycle, and a stage strip that reflects actual state.

The current tab has a stage strip that does nothing and an active batch nobody created. Both are fixed here.

## What you are NOT building

No CardSight identification. No automated GTIN web lookup. No API import. No offline sync. No mobile.

---

## Start with P0, and report what you find

There is an active batch in the current build that appears to be left over from testing. Before anything else, determine whether it has linked raw scan rows.

If it does, it is a real batch. **Abandon it through the lifecycle — do not delete it, and do not delete its scans.** Report the preserved scan count.

If it has no scans, it is seed data. Delete the seed and add an environment guard so fixture batches cannot render outside a fixture environment. That guard is the actual fix; the stale batch is just the symptom.

Report which case it was. Do not guess between them.

---

## The rule that governs this whole feature

**Raw scans are immutable and nothing deletes them.** Not an abandoned batch, not a reset, not a cleanup routine, not a user action. Closing a batch is a status change. Write a test that fails if any path can delete a raw scan, because this is the rule that quietly erodes the first time someone wants a tidy list.

"Reset" in the UI means abandon and start fresh. It never means destroy.

---

## Method is provenance, not a UI choice

A UPC scan, a typed entry, and a CSV row are three different kinds of evidence, and they must stay distinguishable forever. Every ingested row carries its `ingest_method` and `evidence_class`, written at capture and never recomputed at read time.

This matters concretely: manual entry is **user asserted**, which is not the same as verified. Someone typing a card name is making a claim, and six months from now the difference between "a device read this barcode" and "a human typed this" is the difference between trusting a row and checking it.

---

## What a UPC can and cannot tell you

It identifies a SKU. That is all.

It cannot distinguish printings, reprint waves, or condition. It cannot tell a single box from a case — sellers reuse the box barcode on case listings, so that ambiguity is real and already observed in the wild. Anything beyond product identity comes from another method or from a human.

A resolved GTIN is a *candidate* until confirmed once. After confirmation it resolves instantly forever. `needs_review` is never auto-cleared.

Store GTIN as `varchar`, normalized to 14 digits and zero-padded. Never numeric. Validate the mod-10 check digit at entry and reject with a visible reason. A UPC that loses its leading zero is a row that will never match again, and the join key for a table being built by hand is not a place to be casual.

---

## Destination changes the commit contract

This is why there is no shared commit path. Dealer inventory needs cost basis and quantity. Investment needs cost basis and acquisition date. A binder needs a resolved slot, and a commit that cannot resolve one goes to review rather than into the binder. A hunt needs duplicate detection against already-filled slots.

A batch belongs to one destination for its whole life. Changing destination means a new batch.

---

## The capture field

The operator is holding a scanner, not a mouse. Design for that.

Autofocus on mount and re-focus after every row, because a scanner types into whatever has focus and will eventually type into a browser address bar. Unknown codes open an **inline** confirm row, never a modal — a modal breaks the rhythm mid-box. Duplicates increment quantity rather than erroring. Keep a running count visible so a missed scan is distinguishable from a slow one.

Also accept a paste-many input for Storage Mode dumps, one code per line, through the identical validation path.

---

## Definition of done

See the plan file. In short: no phantom active batch, no path that deletes a raw scan, stage strip reading real counters, method and evidence class on every row, GTIN stored as text and checksum-validated, every required state rendered, ADR 0015 written.
