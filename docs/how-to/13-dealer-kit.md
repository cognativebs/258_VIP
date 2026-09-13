# Dealer kit (Flip Score, grading, comps, store)

Sellable tools on the collector face: [`/tools`](http://127.0.0.1:3000/tools).
Logic lives in `@vip/dealer-kit` and is served by VIP `:8787` `/api/tools/*`.

## What shipped

| Product | Price | Route | Download |
| --- | --- | --- | --- |
| Flip Score Deal Sheet | $37 | `/tools/flip-score` | Notion md + score guide + examples CSV |
| Break-Even Grading Calculator | $19 | `/tools/grading` | `.xls` (Excel / Google Sheets) |
| 90-Second Comp Check | $12 | `/tools/comp-check` | Desk laminate + phone field kit |
| Card Store Inventory & Margin | $147 | `/tools/store-inventory` | Notion base + sealed one-pager + Loom script |
| From Collector to Dealer | $197 | `/tools/collector-to-dealer` | Syllabus only — do not film first |

Generated files also land in `products/dealer-kit/` via `npm run export-kit -w @vip/dealer-kit`.

## PriceCharting

Valuation adapter only (ADR 0010 identity seam is unchanged). Set:

```text
PRICECHARTING_API_TOKEN=your_40_char_token
```

in the environment for `npm run api`. Sports lookups use the sister host
`sportscardspro.com` (same token + cents encoding). That hop is **not** a
catalog identifier — `sportscardspro` stays forbidden for identification.

Without a token the adapter is idle and returns `emptyReason`. It never
invents prices. Demo/docs tokens often return identity without condition
values; those payloads stay labeled “identity only”.

Guide values are **not** sold comps. Flip Score still wants eBay / 130point /
PWCC / GoCollect solds. PriceCharting is last in the 90-second order.

## Already started (what this wraps)

- `@vip/decision-engine` → Flip Score action (Buy / Hold / Pass)
- `@vip/intelligence` `evaluateGrading` → expected incremental profit
- Existing eBay / TCGplayer comps adapters stay the sold ledger
