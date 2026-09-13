# Card Store Inventory & Margin System

Airtable/Notion base for an LGS. This is software-shaped: triggers, not a vibe spreadsheet.

**Price:** $147 · B2B. Same VIP decision vocabulary (Buy / Hold / Grade / Sell / Lot / Pass).

## Tables

### 1. SKUs
sku (unique), name, category (sealed/singles/graded/accessories), qty_on_hand, unit_cost, list_price, secondary_low, secondary_high, units_sold_90d, days_since_last_sale, reorder_point_qty, target_margin_pct

### 2. Category targets (locked)

| Category | Floor | Target | Note |
| --- | --- | --- | --- |
| sealed | 18% | 28% | Price off invoice + freight, then glance secondary. Never mark sealed at secondary mid on day one. |
| singles | 35% | 50% | Singles pay rent. If it cannot clear 35% after fees, it is a binder Queen, not case product. |
| graded | 18% | 25% | Slabs move slower. Tighter margin, tighter buy. Dead slabs become cash via auction, not a 40% sticker. |
| accessories | 40% | 55% | Sleeves/toploaders are grocery. High margin, never discount except to close a card sale. |

### 3. Dead-stock workflow

- **Day 90 · Watch:** Move to the front counter or a $5/10/20 bin. Cut list 15%. Stop reordering.
- **Day 120 · Show lot:** Bundle with a mover (etb + dead sleeper, or 3 singles). Take it to the next show.
- **Day 180 · Liquidate:** Auction / group break / staff sale at cost. Do not 'wait for the next set'. That is how rooms fill.

## Sample book (scored)

| SKU | Name | Cat | Qty | Cost | List | vs target | Dead | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PKM-PE-ETB | Pokémon Prismatic Evolutions ETB | sealed | 18 | 48 | 64 | on | none | Hold and restock on trigger. |
| BB-26-CHROME-HBY | 2026 Bowman Chrome Hobby | sealed | 6 | 210 | 279 | on | none | Hold and restock on trigger. |
| ABS-BAT-001 | Absolute Batman #1 | singles | 24 | 4.5 | 12 | above | none | Hold and restock on trigger. |
| CHAR-UNL-RAW | Base Set Charizard #4 raw bin | singles | 3 | 190 | 275 | below | none | Raise list or stop buying this SKU — margin is under category floor. |
| PSA10-MODERN-RB | PSA 10 modern football random | graded | 11 | 85 | 99 | below | watch | Move to the front counter or a $5/10/20 bin. Cut list 15%. Stop reordering. |
| CZ-ETB-DEAD | Crown Zenith ETB (leftover) | sealed | 14 | 44 | 59 | on | liquidate | Auction / group break / staff sale at cost. Do not 'wait for the next set'. That is how rooms fill. |
| SLV-TOPE-100 | Ultra Pro toploaders 25ct | accessories | 40 | 2.1 | 5.99 | above | none | Hold and restock on trigger. |

## Views to create

1. **Reorder today** — reorder = true
2. **Liquidate** — dead_stock = liquidate
3. **Below floor** — vs_target = below
4. **Sealed vs secondary** — category = sealed, sorted by list_vs_secondary

Import `store-sample.csv` then add those filters. That is the whole product.
