# Flip Score Deal Sheet

Duplicate this page. One row per card/comic you are about to buy.

**Price:** $37 · IQVault / Temper scoring, stripped to a deal log.
**Engine:** dealer-kit@0.1.0 wraps `decision-engine@0.1.0`. Target resale is a **range**.

## How to use (2 minutes)

1. Photograph the ask.
2. Paste 3–8 **sold** comps (eBay / 130point / PWCC / GoCollect). PriceCharting is a guide, not a sold.
3. Fill age, pop (or leave blank — blank is *unknown*, not zero), grading cost, listing.
4. Read the action: **Buy now / Hold / Pass** + target resale range.
5. If you do not have 3 solds in 90 days, the only honest action is Pass or Hold.

## Database properties (Notion)

| Property | Type | Notes |
| --- | --- | --- |
| Item | Title | Card / book + print + grade |
| Category | Select | sports / tcg / comics / sealed |
| Age (years) | Number | |
| Pop count | Number | Leave empty if unknown |
| Listing price | Number | Asking price in hand |
| Grading cost | Number | 0 if selling raw |
| Ship / ins | Number | |
| Comp low | Number | 25th pct of solds |
| Comp high | Number | 75th pct of solds |
| Flip Score | Number | From IQVault tool or formula below |
| Action | Select | Buy now / Hold / Pass |
| Target resale | Text | Always a range, e.g. $240–$260 |
| Reasons | Text | One supporting + one opposing |
| PC id | Text | PriceCharting / SportsCardsPro product id |

### Notion formula (margin helper)

```
lets(
  ask, prop("Listing price"),
  low, prop("Comp low"),
  high, prop("Comp high"),
  mid, (low + high) / 2,
  grade, prop("Grading cost"),
  ship, prop("Ship / ins"),
  allIn, ask + grade + ship + mid * 0.13,
  margin, if(allIn == 0, 0, (mid - allIn) / allIn),
  askBand, if(ask <= low, 25, if(ask <= high * 1.12, 12, 0)),
  score, min(100, max(0, margin * 80 + askBand)),
  score
)
```

Pop / age / liquidity still need the IQVault tool — this formula is the margin+ask core only.

## How to read the score

70–100 Strong buy-now territory. Action on this sheet is Buy now — the engine still requires comps, liquidity, and an ask at/under range low for Buy. A high score with thin comps is not a green light.

| Score | Read it as |
| --- | --- |
| 70–100 | Buy-now territory **if** comps exist and ask is at/under the low |
| 45–69 | Hold / watch — in band, not a steal |
| 0–44 | Pass — overpaying, thin comps, or a trap |

A 90 with two comps is a vanity number. Evidence count beats the score.

## 10 pre-filled decisions (teaching snapshots · unverified)

Comp dollars are **manual sold snapshots** for the sheet, not live API prints. PriceCharting ids are real so a paid token can refresh the condition ladder.

| Item | Ask | Target resale | Score | Action | Pop | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1986 Fleer Michael Jordan #57 raw | 3600 | 5125–5500 | 67.59 | **Buy now** | 312 | Ask sits under a tight raw band. Pop 312 is the 10 census — do not confuse that with raw supply. |
| Base Set Charizard #4 unlimited | 420 | 246–256.25 | 11.99 | **Pass** | 18400 | Classic trap: pay over raw comps, then add Priority fees, into a 18k pop. |
| Amazing Spider-Man #1 (1963) | 21000 | 20250–22750 | 35.75 | **Hold** | 42 | In-band on a thin key. Hold — you are not being paid to take restoration risk. |
| 1952 Topps Mickey Mantle #311 | 185000 | 98500–106000 | 21.75 | **Pass** | 88 | Ask is ~2× the sold band. Famous card ≠ automatic deal. |
| Alpha Black Lotus | 280000 | 267500–292500 | 35.75 | **Hold** | 19 | Hold. You can be right on price and still wait a year for the next check. |
| Incredible Hulk #181 (1974) | 140 | 235–252.5 | 72.59 | **Buy now** | 2100 | Buy the book, skip the slab. Discount to raw solds is the whole trade. |
| 2003 Topps Chrome LeBron #111 | 505 | 495–535 | 22.75 | **Hold** | 5400 | Hold / pass on grading. You are buying a liquid raw card, not a 10 ticket. |
| Blue-Eyes White Dragon LOB-001 | 95 | 43.5–49.75 | 11.99 | **Pass** | 8900 | Pass. Name the print or you overpay. 1st Edition is a different SKU (id 2530687). |
| Base Set Charizard #4 1st Edition | 7200 | 11125–12275 | 76.99 | **Buy now** | 164 | Buy now on raw vs a real 1st band — after you have named the print. |
| Prismatic Evolutions ETB (sealed) | 89 | 49.5–52.75 | 5.99 | **Pass** | 50000 | Pass. Modern sealed after the chase window is how rooms fill with dead cardboard. |

## Provenance rule

Inferred · unverified is printed on every derived field. Never paste a PriceCharting guide number into "sold comps".
