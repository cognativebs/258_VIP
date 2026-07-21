# Pokémon 30 Intelligence Engine — Procedure v1.0

## User Profile
- Budget: $2,500
- Above-MSRP tolerance: Pokémon Center ETBs and Ultra-Premium Collections only
- Local Game Store preorder tolerance: Yes, up to 10–15% over MSRP if allocation is credible
- Memberships: acceptable; user has Sam’s Club
- Max desired quantity per product: 4
- Goal: Maximum ROI

## Mission
Run this procedure repeatedly from July 2026 through the release and restock windows for Pokémon TCG: 30th Celebration. Each run should identify new facts, compare them against prior runs, update probabilities, and produce a concrete acquisition plan.

## Run Cadence
- July–early August: 2x per week
- Mid-August through September 16: daily
- Release week: morning, lunch, evening checks
- October/November product waves: daily starting 10 days before each wave
- Holiday season: weekly restock checks

## Sources to Check Every Run
### Official / Primary
1. Pokémon Center
2. Pokémon.com news and product pages
3. GameStop
4. Best Buy
5. Target
6. Walmart, direct from Walmart only
7. Amazon, sold by Amazon only
8. Costco
9. Sam’s Club

### Secondary / Intel
1. PokeBeach
2. Bulbagarden
3. TrackaLacker / stock trackers
4. Reddit r/PokemonTCG and r/PokeInvesting for early alerts only
5. X/Twitter and Discord drop-alert accounts, if user provides preferred accounts

## Search Tasks Every Run
Run fresh searches for:
- Pokémon 30th Celebration preorder
- Pokémon 30th Celebration Pokémon Center ETB preorder
- Pokémon 30th Celebration UPC preorder
- Pokémon 30th Celebration Booster Bundle preorder
- Pokémon 30th Celebration GameStop preorder
- Pokémon 30th Celebration Best Buy preorder
- Pokémon 30th Celebration Target preorder
- Pokémon 30th Celebration Walmart preorder
- Pokémon 30th Celebration Sam’s Club bundle
- Pokémon 30th Celebration Costco bundle
- Pokémon 30th Celebration allocation rumors
- Pokémon 30th Celebration restock
- Pokémon 30th Celebration MSRP

## Data Captured Each Run
For every product:
- Product name
- Release wave/date
- MSRP
- Pack count
- Retailer status
- Preorder status
- Quantity limit
- Price
- Shipping/tax notes
- Sellout risk
- Scalper pressure
- Buy/Wait/Pass status
- Confidence score
- Notes

For every retailer:
- Has page gone live?
- Can product be wishlisted?
- Is preorder open?
- Is pickup available?
- Is membership required?
- Are there quantity limits?
- Is seller direct or marketplace?
- Drop probability in next 7 days

## Scoring Model
### Product ROI Score, 0–100
- Exclusivity: 0–20
- Pack efficiency: 0–20
- Character/promos: 0–20
- Storage efficiency: 0–10
- Liquidity: 0–15
- Scarcity/sellout pressure: 0–15

### Retailer Reliability Score, 0–100
- MSRP reliability: 0–25
- Bot resistance: 0–20
- Drop predictability: 0–15
- Account readiness: 0–15
- Shipping/return reliability: 0–15
- Quantity limit usefulness: 0–10

## Decision Rules
### Buy at MSRP
- Pokémon Center ETB: buy up to 4
- UPC Day/Espeon: buy up to 2
- UPC Night/Umbreon: buy up to 2
- Booster Bundle: buy up to 4–12 depending on budget state
- Regular ETB: buy up to 2 only after PC ETB allocation attempt

### Pay Above MSRP
Only allow premiums for:
- Pokémon Center ETB: up to ~$90 early, max ~$110 if sellout confirmed
- UPC: up to ~$230 early, max ~$260 if sellout confirmed

### MSRP-only or pass
- Poster Collection
- Tech Sticker Collection
- Knock Out Collection
- 2-Pack Blister
- Mini Tins
- Battle Decks
- Binder Collection
- Regular ex Boxes, unless Greninja/Sylveon demand becomes extreme

## Output Required Every Run
1. Executive summary
2. What changed since last run
3. Retailer status table
4. Product status table
5. Prediction changes
6. Immediate action list
7. Budget allocation update
8. IQVault JSON payload
9. Saved-search strings
10. Questions for the user, only if a decision needs preference input

## Prediction Tracking
Each run should record predictions in this form:
- Prediction
- Probability
- Evidence
- Action to take
- Expiration date
- Outcome, once known
- Error analysis
- Adjustment for future runs

## IQVault Integration Schema
```json
{
  "run_id": "P30IE-YYYYMMDD-N",
  "user_profile": {},
  "products": [],
  "retailers": [],
  "signals": [],
  "predictions": [],
  "actions": [],
  "budget_plan": {},
  "source_log": []
}
```

## User-Specific Bias
This engine should favor:
- ROI over completeness
- MSRP over hype chasing
- Pokémon Center exclusivity
- UPCs and booster bundles
- Products with high liquidity and compact storage
- Avoiding low-efficiency sealed clutter
