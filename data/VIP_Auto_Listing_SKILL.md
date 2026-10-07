from pathlib import Path

content = r"""# VIP Auto-Listing Skill

## Purpose
Generate high-quality marketplace listings for collectible cards and comics inside VIP/IQVault. The system should identify the item, surface the attributes that actually drive buyer search and value, choose a selling posture, and create a clean eBay-ready listing without hype or keyword spam.

## Core Principle
Do not treat every item as inventory that must sell quickly.

Each item receives a **Selling Posture** before pricing:

1. **Liquidation** — prioritize speed and market-clearing price.
2. **Dealer Inventory** — normal market price plus reasonable margin.
3. **Opportunistic Sell** — desirable item; list above market and accept a strong offer.
4. **Vault With a Price** — long-term hold thesis remains intact, but item can be bought at a deliberate "make me sell it" price.
5. **Vault / Not for Sale** — do not publish a listing.

The user can override the posture at any time.

---

## CARD WORKFLOW

### 1. Identify the Card
Extract and reconcile:
- Player
- Year
- Manufacturer / brand
- Product / set
- Insert or subset
- Card number
- Parallel / variation
- Rookie status
- Team
- Serial number / print run
- Autograph
- Memorabilia / patch
- Grading company
- Numeric grade
- Autograph grade
- Certification number
- Important subgrades
- Factory seal / buyback / encasement
- Other scarcity indicators

Do not rely on OCR alone. Use visual features, label text, front/back text, catalog/checklist sources, certification data where available, and exact-card comparisons.

### 2. Distinguish Original Card From Later Buyback/Reissue
This is critical for products such as Panini Honors/Recollection Collection.

Example:
- Original card: 2017 Panini Classics Drew Brees #89.
- Later product: 2018 Panini Honors Recollection Collection.
- Treatment: original card was repurposed, hard-signed, hand-numbered, and factory sealed for the later Honors release.

The listing title and description must represent the later collectible correctly instead of falsely presenting it as an ordinary 2017 autograph.

### 3. Build Search-Value Hierarchy
Rank card attributes by what buyers are most likely to search.

Typical hierarchy:
**Player > major chase/parallel/auto > scarcity (/10, /5, 1/1) > product/set > grade > card number > team**

Examples:
- Drew Brees > Downtown > Optic > CSG 9.5 > DT-2
- Drew Brees > Auto > /10 > Encased > BGS 9/10
- Drew Brees > Zebra Prizm > Select > PSA 9 > #43

Never mechanically use the same order for every card.

### 4. Create eBay Title
Target eBay's title limit.
Prioritize meaningful search terms.
Avoid:
- INVESTMENT
- 🔥 / emoji spam
- L@@K
- RARE unless scarcity is genuinely relevant
- HOF/GOAT filler when better item-specific terms exist

Preferred style:
`YEAR PRODUCT PLAYER KEY ATTRIBUTE CARD# GRADE SCARCITY/TEAM`

### 5. Description Style
Descriptions should be concise, factual, and confidence-building.

Recommended structure:

**Opening sentence**
Identify the exact collectible and its most important features.

**Card details**
- Player
- Year
- Set/product
- Insert/parallel
- Card number
- Serial number
- Team
- Grade / grader
- Auto / auto grade
- Certification number

**Condition/fulfillment**
"The exact card pictured is the card you will receive."

For graded cards, do not independently assign condition to the card beyond the grader's label.

**Shipping**
"The slab/card will be carefully protected and securely packaged for shipment."

**Collector relevance**
One short sentence identifying logical collector audiences without hype.

### 6. Pricing Research
When pricing matters, collect as many of these as possible:
- Recent sold examples of exact card
- Same card in adjacent grades
- Raw sales
- Other grading-company sales
- Closely comparable serial-numbered versions
- Active listings only as supply/ask context
- Population / print-run context when available

Sold transactions carry more weight than unsold asking prices.

Do not pretend a thin market has a precise value. Explicitly identify sparse comps.

### 7. Grade Normalization
Do not equate grades across companies automatically.

Examples:
- PSA 10 usually commands a different market premium than CSG/CGC/BGS 9.5.
- Strong subgrades may support a higher asking price but do not erase grader-market differences.
- Older slabs/labels can have different buyer preferences.

### 8. Pricing by Selling Posture

#### Liquidation
- BIN near or slightly below current market.
- Offers optional.
- Objective: velocity.

#### Dealer Inventory
- BIN roughly 5–15% over expected transaction price.
- Best Offer on.
- Normal negotiation room.

#### Opportunistic Sell
- BIN roughly 20–50% above current expected market, adjusted for scarcity.
- Best Offer on.
- Set an internal minimum acceptable price.
- Do not automatically reduce because the listing is old.

#### Vault With a Price
- Use a "make me sell it" price.
- Price may sit materially above current comps.
- Best Offer on when useful.
- Reprice only when new market information changes the thesis.
- Listing is also a market-sensing tool: watchers and offers provide demand information.

#### Vault / Not for Sale
- No marketplace listing.
- Continue tracking price, sales, population, news, and thesis.

### 9. Internal Price Fields
VIP should store separately:
- Estimated Fair Market Value
- Suggested BIN
- Offer Floor
- Target Transaction Price
- Selling Posture
- User Minimum ("I would regret selling below...")
- Last Comp Date
- Comp Confidence: HIGH / MEDIUM / LOW
- Appreciation Thesis: Bullish / Neutral / Bearish
- Repricing Trigger

Do not overwrite fair market value with the asking price.

### 10. Repricing Triggers
Re-evaluate when:
- A new exact-card comp appears.
- Multiple adjacent-grade comps materially move.
- Player milestone / Hall of Fame / major event changes demand.
- Population or print-run information changes.
- A credible offer reveals stronger demand.
- User changes selling posture.
- Listing receives significant watchers but no conversion over a meaningful period.

Do not blindly lower prices every 7/14/30 days for Opportunistic Sell or Vault With a Price.

---

## COMIC WORKFLOW

### 1. Identify
Capture:
- Series/title
- Issue number
- Publisher
- Publication year/date
- Volume
- Cover artist
- Cover designation (A/B/C/etc.)
- Variant type
- Ratio incentive
- Store/exclusive variant
- Printing
- Key issue significance
- Major first appearance / cameo / event, if verified
- Grade/slab company
- Certification number
- Raw condition when appropriate
- Newsstand/direct edition
- Barcode/UPC + supplemental code

### 2. Search-Value Hierarchy
Typical hierarchy:
**Series + issue > major key/character > variant/ratio > artist > grade > publisher/year**

Do not add unverified "1st appearance" or "key issue" claims.

### 3. Pricing
Favor:
- Exact cover + exact grade comps
- Same variant in adjacent grades
- Raw/slab relationships
- Recent sales over old guide values

CoverPrice or other guide values are reference signals, not automatic list prices.

### 4. Listing Style
Same philosophy as cards:
- factual
- concise
- exact item pictured
- no fabricated scarcity
- no hype spam
- selling posture controls price behavior

---

## LISTING OUTPUT CONTRACT

For each auto-listing, VIP should generate:

### Identification
Exact normalized identity with confidence score.

### Recommended Title
One optimized eBay title.

### Description
Paste-ready marketplace description.

### Item Specifics
Structured marketplace fields.

### Pricing
- Estimated FMV
- Suggested BIN
- Best Offer ON/OFF
- Suggested auto-decline / floor
- Target transaction range
- Selling posture
- Pricing rationale
- Comp confidence

### Evidence
Links/IDs for the comps and checklist/certification sources used.

### Warnings
Examples:
- identity uncertain
- thin comps
- autograph authentication unclear
- hand-numbered vs manufacturer serial-numbered ambiguity
- raw condition uncertain
- possible variant mismatch

---

## USER EXPERIENCE INSIDE VIP

The user should not need to remember any of this structure.

Default flow:

**Scan/Photo → Identify → Price → Choose/Infer Selling Posture → Generate Listing → User Review → Publish**

The listing screen should expose only the useful controls:
- Sell posture
- BIN
- Best Offer
- Minimum acceptable offer
- Publish

Advanced evidence, comps, and confidence should be expandable rather than cluttering the main workflow.

VIP should learn from user edits:
- preferred title ordering
- preferred description length
- pricing aggressiveness
- items the user tends to hold
- preferred shipping language
- categories where the user accepts lower liquidity

---

## CURRENT USER STYLE
- Clean, professional listings.
- No cheesy hype.
- Search terms should be prioritized by actual buyer importance.
- Exact card pictured language.
- High-quality cards should not be priced for speed unless explicitly requested.
- Long-term-growth cards can be listed at a deliberate premium as "Vault With a Price."
- Pricing should distinguish current FMV from the user's willingness-to-sell price.
"""

path = Path("/mnt/data/VIP_Auto_Listing_SKILL.md")
path.write_text(content, encoding="utf-8")
print(f"Created {path}")
