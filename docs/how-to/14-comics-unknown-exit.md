# How-To: Unrecorded bulk giveaway (unknown exit)

The committed CLZ proof (`comic_2026-07-04_19-11-11-export.xml`) is a **catalog
list**, not a physical count. If you gifted bulk books and never wrote down
which titles, do **not** delete ~1,000 holdings and do **not** invent a list.

## What this is for

You gave away a large share of **bulk** (probably General Inventory — 1,044
books / about $3,640 of the ~$24k catalog). Titles unknown. Collection value
barely moves; keys stay.

## What IQVault will not do

- DELETE holdings
- Set `dropped_at` from this event
- Pick which General Inventory rows "must have left"
- Present a single remaining value as fact

## Record the exit

1. Open the Comics terminal (`:3000/collections/comics`).
2. In **CLZ LIST ≠ PHYSICAL COUNT**, set estimated qty (default 1000) and the
   recipient note.
3. Check **I do not know which titles left**.
4. **Record unknown exit**.

The grid still shows every CLZ row. Top bar adds **Physical** as a range:
`catalog − (General Inventory × gifted share)` to `catalog`, labeled
**inferred · unverified**.

Decision:

- **Pass** on treating General Inventory as physically confirmed sell/lot stock
- **Hold** keys, museum, and themed pillars

## When a new CLZ export helps

Only if you already removed the gifted books **in Comic Collector**. Then drop
XML per [how-to 07](07-clz-inbox-sync.md). Missing rows get `dropped_at` (never
DELETE). If CLZ still lists the gift, a new export changes nothing.

## Check

```bash
curl http://127.0.0.1:5200/api/comics/unknown-exit
# or
curl http://127.0.0.1:8787/api/comics/unknown-exit
```

`event.holdingsTouched` is always `false`. `impact.titlesInvented` is always
`false`. `impact.method` is `inferred`.
