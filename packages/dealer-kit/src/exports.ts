import { COMP_CHECK_STEPS, COMP_RED_FLAGS, COMP_SOURCES } from "./comp-check.js";
import { runFlipExamples, type FlipExample } from "./examples.js";
import { howToReadFlipScore } from "./flip-score.js";
import { GRADING_FEE_AS_OF, GRADING_FEE_TIERS } from "./grading-fees.js";
import { POP_RED_FLAG_GUIDE } from "./pop-red-flags.js";
import {
  CATEGORY_MARGIN_TARGETS,
  DEAD_STOCK_WORKFLOW,
  SAMPLE_STORE_SKUS,
  SEALED_PRICING_RULES,
  scoreStoreBook,
} from "./store-inventory.js";
import type { FlipDealResult } from "./schemas.js";
import { DEALER_KIT_VERSION } from "./version.js";

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n") + "\n";
}

export function flipExamplesCsv(): string {
  const runs = runFlipExamples();
  return toCsv(
    [
      "id",
      "headline",
      "action",
      "flip_score",
      "listing",
      "target_low",
      "target_high",
      "target_mid",
      "max_buy",
      "comps",
      "pop",
      "age",
      "pc_host",
      "pc_id",
      "why",
    ],
    runs.map(({ example, result }) => [
      example.id,
      example.headline,
      result.actionLabel,
      result.flipScore,
      example.input.listingPrice,
      result.targetResaleLow,
      result.targetResaleHigh,
      result.targetResaleMid,
      result.maxBuy,
      result.matchedComps,
      example.input.popCount,
      example.input.ageYears,
      example.pricecharting.host,
      example.pricecharting.id,
      example.whyItMatters,
    ]),
  );
}

export function gradingFeesCsv(): string {
  return toCsv(
    [
      "id",
      "grader",
      "category",
      "name",
      "lane",
      "fee_usd",
      "turnaround_bd",
      "max_insured",
      "min_qty",
      "status",
      "notes",
      "as_of",
    ],
    GRADING_FEE_TIERS.map((t) => [
      t.id,
      t.grader,
      t.category,
      t.name,
      t.lane,
      t.feeUsd,
      t.turnaroundBusinessDays,
      t.maxInsuredValueUsd,
      t.minQty,
      t.status,
      t.notes,
      GRADING_FEE_AS_OF,
    ]),
  );
}

export function popRedFlagsCsv(): string {
  return toCsv(
    ["id", "title", "when", "why"],
    POP_RED_FLAG_GUIDE.map((r) => [r.id, r.title, r.when, r.why]),
  );
}

export function storeSampleCsv(): string {
  const book = scoreStoreBook(SAMPLE_STORE_SKUS);
  return toCsv(
    [
      "sku",
      "name",
      "category",
      "qty",
      "unit_cost",
      "list",
      "margin_pct",
      "vs_target",
      "days_of_supply",
      "reorder",
      "dead_stock",
      "list_vs_secondary",
      "next_action",
    ],
    SAMPLE_STORE_SKUS.map((s, i) => {
      const r = book.rows[i]!;
      return [
        s.sku,
        s.name,
        s.category,
        s.qtyOnHand,
        s.unitCost,
        s.listPrice,
        r.marginPct != null ? Math.round(r.marginPct * 1000) / 10 : "",
        r.vsTarget,
        r.daysOfSupply,
        r.reorder,
        r.deadStock,
        r.listVsSecondary,
        r.nextAction,
      ];
    }),
  );
}

export function notionFlipTemplate(runs: { example: FlipExample; result: FlipDealResult }[]): string {
  const rows = runs
    .map(
      ({ example, result }) =>
        `| ${example.headline} | ${example.input.listingPrice} | ${result.targetResaleLow ?? "—"}–${result.targetResaleHigh ?? "—"} | ${result.flipScore} | **${result.actionLabel}** | ${example.input.popCount ?? "unknown"} | ${example.whyItMatters} |`,
    )
    .join("\n");
  return `# Flip Score Deal Sheet

Duplicate this page. One row per card/comic you are about to buy.

**Price:** $37 · IQVault / Temper scoring, stripped to a deal log.
**Engine:** ${DEALER_KIT_VERSION} wraps \`decision-engine@0.1.0\`. Target resale is a **range**.

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

\`\`\`
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
\`\`\`

Pop / age / liquidity still need the IQVault tool — this formula is the margin+ask core only.

## How to read the score

${howToReadFlipScore(72, "buy_now")}

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
${rows}

## Provenance rule

Inferred · unverified is printed on every derived field. Never paste a PriceCharting guide number into "sold comps".
`;
}

export function notionStoreBase(): string {
  const book = scoreStoreBook(SAMPLE_STORE_SKUS);
  const rows = SAMPLE_STORE_SKUS.map((s, i) => {
    const r = book.rows[i]!;
    return `| ${s.sku} | ${s.name} | ${s.category} | ${s.qtyOnHand} | ${s.unitCost} | ${s.listPrice} | ${r.vsTarget} | ${r.deadStock} | ${r.nextAction} |`;
  }).join("\n");
  return `# Card Store Inventory & Margin System

Airtable/Notion base for an LGS. This is software-shaped: triggers, not a vibe spreadsheet.

**Price:** $147 · B2B. Same VIP decision vocabulary (Buy / Hold / Grade / Sell / Lot / Pass).

## Tables

### 1. SKUs
sku (unique), name, category (sealed/singles/graded/accessories), qty_on_hand, unit_cost, list_price, secondary_low, secondary_high, units_sold_90d, days_since_last_sale, reorder_point_qty, target_margin_pct

### 2. Category targets (locked)

| Category | Floor | Target | Note |
| --- | --- | --- | --- |
${Object.entries(CATEGORY_MARGIN_TARGETS)
  .map(([k, v]) => `| ${k} | ${Math.round(v.min * 100)}% | ${Math.round(v.target * 100)}% | ${v.note} |`)
  .join("\n")}

### 3. Dead-stock workflow

${DEAD_STOCK_WORKFLOW.map((s) => `- **Day ${s.day} · ${s.label}:** ${s.action}`).join("\n")}

## Sample book (scored)

| SKU | Name | Cat | Qty | Cost | List | vs target | Dead | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

## Views to create

1. **Reorder today** — reorder = true
2. **Liquidate** — dead_stock = liquidate
3. **Below floor** — vs_target = below
4. **Sealed vs secondary** — category = sealed, sorted by list_vs_secondary

Import \`store-sample.csv\` then add those filters. That is the whole product.
`;
}

export function gradingCalculatorXml(): string {
  const feeRows = GRADING_FEE_TIERS.map(
    (t) => `
    <Row>
      <Cell><Data ss:Type="String">${escXml(t.id)}</Data></Cell>
      <Cell><Data ss:Type="String">${t.grader}</Data></Cell>
      <Cell><Data ss:Type="String">${t.category}</Data></Cell>
      <Cell><Data ss:Type="String">${escXml(t.name)}</Data></Cell>
      <Cell><Data ss:Type="String">${t.lane}</Data></Cell>
      <Cell><Data ss:Type="Number">${t.feeUsd}</Data></Cell>
      <Cell><Data ss:Type="Number">${t.turnaroundBusinessDays}</Data></Cell>
      <Cell><Data ss:Type="${t.maxInsuredValueUsd == null ? "String" : "Number"}">${t.maxInsuredValueUsd ?? ""}</Data></Cell>
      <Cell><Data ss:Type="Number">${t.minQty}</Data></Cell>
      <Cell><Data ss:Type="String">${t.status}</Data></Cell>
      <Cell><Data ss:Type="String">${escXml(t.notes)}</Data></Cell>
    </Row>`,
  ).join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#111827" ss:Pattern="Solid"/><Font ss:Color="#D4A853"/></Style>
    <Style ss:ID="Input"><Interior ss:Color="#FFF3CD" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Out"><Font ss:Bold="1"/></Style>
  </Styles>
  <Worksheet ss:Name="Calculator">
    <Table>
      <Row><Cell><Data ss:Type="String">Break-Even Grading Calculator</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Fees as of ${GRADING_FEE_AS_OF} · confirm at checkout · ${DEALER_KIT_VERSION}</Data></Cell></Row>
      <Row></Row>
      <Row>
        <Cell><Data ss:Type="String">Raw cost</Data></Cell>
        <Cell ss:StyleID="Input"><Data ss:Type="Number">100</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Grading fee (from Fees tab)</Data></Cell>
        <Cell ss:StyleID="Input"><Data ss:Type="Number">59.99</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Shipping</Data></Cell>
        <Cell ss:StyleID="Input"><Data ss:Type="Number">15</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Insurance</Data></Cell>
        <Cell ss:StyleID="Input"><Data ss:Type="Number">0</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Selling fee %</Data></Cell>
        <Cell ss:StyleID="Input"><Data ss:Type="Number">0.13</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">All-in before sale</Data></Cell>
        <Cell ss:StyleID="Out" ss:Formula="=R[-5]C+R[-4]C+R[-3]C+R[-2]C"><Data ss:Type="Number">174.99</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Min sale to break even (any grade)</Data></Cell>
        <Cell ss:StyleID="Out" ss:Formula="=R[-1]C/(1-R[-3]C)"><Data ss:Type="Number">201.14</Data></Cell>
      </Row>
      <Row></Row>
      <Row><Cell><Data ss:Type="String">Optional market value</Data></Cell><Cell><Data ss:Type="String">Expected net vs all-in</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Grade 7</Data></Cell><Cell ss:StyleID="Input"><Data ss:Type="Number">0</Data></Cell><Cell ss:Formula="=IF(RC[-1]=0,&quot;&quot;,RC[-1]*(1-R8C2)-R9C2)"><Data ss:Type="String"></Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Grade 8</Data></Cell><Cell ss:StyleID="Input"><Data ss:Type="Number">0</Data></Cell><Cell ss:Formula="=IF(RC[-1]=0,&quot;&quot;,RC[-1]*(1-R8C2)-R9C2)"><Data ss:Type="String"></Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Grade 9</Data></Cell><Cell ss:StyleID="Input"><Data ss:Type="Number">0</Data></Cell><Cell ss:Formula="=IF(RC[-1]=0,&quot;&quot;,RC[-1]*(1-R8C2)-R9C2)"><Data ss:Type="String"></Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Grade 9.5</Data></Cell><Cell ss:StyleID="Input"><Data ss:Type="Number">0</Data></Cell><Cell ss:Formula="=IF(RC[-1]=0,&quot;&quot;,RC[-1]*(1-R8C2)-R9C2)"><Data ss:Type="String"></Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Grade 10</Data></Cell><Cell ss:StyleID="Input"><Data ss:Type="Number">0</Data></Cell><Cell ss:Formula="=IF(RC[-1]=0,&quot;&quot;,RC[-1]*(1-R8C2)-R9C2)"><Data ss:Type="String"></Data></Cell></Row>
    </Table>
  </Worksheet>
  <Worksheet ss:Name="Fees">
    <Table>
      <Row ss:StyleID="Header">
        <Cell><Data ss:Type="String">id</Data></Cell>
        <Cell><Data ss:Type="String">grader</Data></Cell>
        <Cell><Data ss:Type="String">category</Data></Cell>
        <Cell><Data ss:Type="String">name</Data></Cell>
        <Cell><Data ss:Type="String">lane</Data></Cell>
        <Cell><Data ss:Type="String">fee</Data></Cell>
        <Cell><Data ss:Type="String">turnaround_bd</Data></Cell>
        <Cell><Data ss:Type="String">max_insured</Data></Cell>
        <Cell><Data ss:Type="String">min_qty</Data></Cell>
        <Cell><Data ss:Type="String">status</Data></Cell>
        <Cell><Data ss:Type="String">notes</Data></Cell>
      </Row>${feeRows}
    </Table>
  </Worksheet>
  <Worksheet ss:Name="Pop red flags">
    <Table>
      <Row ss:StyleID="Header">
        <Cell><Data ss:Type="String">id</Data></Cell>
        <Cell><Data ss:Type="String">title</Data></Cell>
        <Cell><Data ss:Type="String">when</Data></Cell>
        <Cell><Data ss:Type="String">why</Data></Cell>
      </Row>
      ${POP_RED_FLAG_GUIDE.map(
        (r) => `<Row><Cell><Data ss:Type="String">${escXml(r.id)}</Data></Cell><Cell><Data ss:Type="String">${escXml(r.title)}</Data></Cell><Cell><Data ss:Type="String">${escXml(r.when)}</Data></Cell><Cell><Data ss:Type="String">${escXml(r.why)}</Data></Cell></Row>`,
      ).join("")}
    </Table>
  </Worksheet>
  <Worksheet ss:Name="Lanes">
    <Table>
      <Row><Cell><Data ss:Type="String">Dropdown presets</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">bulk</Data></Cell><Cell><Data ss:Type="String">Value Bulk / CGC Bulk / BGS Base — cheapest, slowest, often paused or min-qty.</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">value</Data></Cell><Cell><Data ss:Type="String">PSA Standard/Priority, CGC Economy/Standard — default hobby lane.</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">express</Data></Cell><Cell><Data ss:Type="String">PSA Express/Premier, CGC Express, BGS Express/Priority — only when the card already clears the fee 3×.</Data></Cell></Row>
    </Table>
  </Worksheet>
</Workbook>
`;
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function flipScoreGuideHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>How to read the Flip Score</title>
<style>
  @page { size: letter; margin: 0.55in; }
  body { font: 12px/1.45 "Iowan Old Style", Georgia, serif; color: #111; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  h2 { font-size: 14px; margin: 16px 0 6px; letter-spacing: .04em; text-transform: uppercase; }
  .band { display: flex; gap: 8px; margin: 12px 0; }
  .box { flex: 1; border: 2px solid #111; padding: 8px; }
  .buy { background: #d1fae5; } .hold { background: #fef3c7; } .pass { background: #fee2e2; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #444; padding: 4px 6px; text-align: left; }
  footer { margin-top: 14px; font-size: 10px; color: #444; }
</style></head><body>
<h1>How to read the Flip Score</h1>
<p>One page. Print it. Tape it inside the show binder. ${DEALER_KIT_VERSION}.</p>
<div class="band">
  <div class="box buy"><strong>70–100 Buy now</strong><br>Ask at/under sold low. ≥3 comps. Liquidity not dead.</div>
  <div class="box hold"><strong>45–69 Hold</strong><br>In band. Fine collection copy. Not a trade.</div>
  <div class="box pass"><strong>0–44 Pass</strong><br>Over the high, no comps, or a named trap.</div>
</div>
<h2>The number is not the decision</h2>
<p>VIP still ends in Buy / Hold / Grade / Sell / Lot / Pass with reasons. Flip Score is the stripped front. A 90 with two comps is a vanity number.</p>
<h2>Weights</h2>
<table>
  <tr><th>Margin</th><td>0–40</td><td>Modeled exit net ÷ buy basis</td></tr>
  <tr><th>Ask vs band</th><td>0 / 12 / 25</td><td>Over / in-band / under low</td></tr>
  <tr><th>Liquidity</th><td>0–15</td><td>How often this thing actually sells</td></tr>
  <tr><th>Pop</th><td>0–10</td><td>Blank = unknown = 5. Never treat blank as scarce.</td></tr>
  <tr><th>Age</th><td>1–10</td><td>Vintage established vs still-printing modern</td></tr>
</table>
<h2>Target resale</h2>
<p>Always a <em>range</em> (comp 25th–75th) plus a mid used only for margin math. Never write a single dollar as “worth”.</p>
<footer>Comps from solds. PriceCharting is a guide, last. Inferred values stay labeled unverified.</footer>
</body></html>`;
}

export function compCheckDeskHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>90-Second Comp Check</title>
<style>
  @page { size: letter; margin: 0.5in; }
  body { font: 13px/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; }
  h1 { font-size: 26px; margin: 0; }
  .sub { color: #444; margin: 4px 0 14px; }
  ol { padding-left: 18px; }
  li { margin: 6px 0; }
  .flags { display: flex; gap: 8px; }
  .flag { flex: 1; border: 3px solid #111; padding: 8px; min-height: 140px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #333; padding: 4px; text-align: left; }
</style></head><body>
<h1>90-Second Comp Check</h1>
<p class="sub">Laminate this. $12 field kit. If it takes longer than 90s you are researching, not buying.</p>
<ol>${COMP_CHECK_STEPS.map((s) => `<li>${s}</li>`).join("")}</ol>
<h2>Three traps</h2>
<div class="flags">${COMP_RED_FLAGS.map((f) => `<div class="flag"><strong>${f.title}</strong><div style="font-size:11px;margin-top:6px">${f.tells[0]}</div><div style="font-size:11px;margin-top:8px"><em>${f.doInstead}</em></div></div>`).join("")}</div>
<h2>Source order</h2>
<table><tr><th>#</th><th>Source</th><th>Use for</th><th>Caveat</th></tr>
${COMP_SOURCES.map((s) => `<tr><td>${s.order}</td><td>${s.name}</td><td>${s.useFor}</td><td>${s.caveat}</td></tr>`).join("")}
</table>
</body></html>`;
}

export function compCheckFieldHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comp Check · field kit</title>
<style>
  body { margin: 0; background: #0a0e17; color: #e8edf5; font: 16px/1.4 system-ui, sans-serif; }
  .phone { max-width: 390px; margin: 0 auto; padding: 16px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 8px; color: #d4a853; }
  .step { background: #111827; border: 1px solid #2a3548; border-radius: 10px; padding: 10px 12px; margin: 8px 0; }
  .n { color: #d4a853; font-weight: 700; }
  .trap { background: #3b1111; border-color: #7f1d1d; }
</style></head><body><div class="phone">
<h1>90s Comp Check</h1>
<p>Standing at the table. Screenshot this.</p>
${COMP_CHECK_STEPS.map((s, i) => `<div class="step"><span class="n">${i + 1}.</span> ${s}</div>`).join("")}
${COMP_RED_FLAGS.map((f) => `<div class="step trap"><strong>${f.title}</strong><div>${f.doInstead}</div></div>`).join("")}
<p style="opacity:.7;font-size:13px">Sold → 130point → cert/print → PriceCharting last.</p>
</div></body></html>`;
}

export function sealedPricingHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>How to price sealed vs secondary</title>
<style>
  @page { size: letter; margin: 0.6in; }
  body { font: 13px/1.45 Georgia, serif; }
  h1 { font-size: 22px; }
  li { margin: 8px 0; }
</style></head><body>
<h1>How to price sealed product against the secondary market</h1>
<p>One pager for the counter. ${DEALER_KIT_VERSION}.</p>
<ol>${SEALED_PRICING_RULES.map((r) => `<li>${r}</li>`).join("")}</ol>
<p><strong>Worked check:</strong> invoice $48 + freight $2 = $50 floor. eBay sold last week $52–$68. Sticker $64 (in band, 28% on list). If solds print $44, you do not have a product — you have a lot.</p>
</body></html>`;
}

export function courseSyllabusMd(): string {
  return `# From Collector to Dealer

**$197 flagship · do not record this first.** Ship the $12–$37 tools, collect results, then film.

## Bundle (toolkit bonus)

1. Flip Score Deal Sheet — $37
2. Break-Even Grading Calculator — $19
3. 90-Second Comp Check — $12
4. Card Store Inventory & Margin System — $147

## Modules (outline only)

| # | Title | Minutes | Outcome |
| --- | --- | --- | --- |
| 1 | The only decision that matters | 15 | Buy / Hold / Grade / Sell / Lot / Pass with a reason |
| 2 | Comp like a grown-up | 18 | 90-second order + three traps |
| 3 | When grading is a fee, not a dream | 20 | Break-even at 7 / 8 / 9 / 9.5 / 10 |
| 4 | Flip Score at a show | 15 | Run the deal sheet on two live asks |
| 5 | Sourcing: LCS, shows, estates | 20 | Relationship math, not hustle theater |
| 6 | eBay listing that actually sells | 18 | Title, comps, fees, lots |
| 7 | The weekly pipeline | 15 | Buy → decide → list → review |
| 8 | Store mode (optional) | 15 | Margin floors + dead-stock days |

No videos in this repo until the cheaper products have receipts.
`;
}

export function walkthroughScriptMd(): string {
  return `# 15-minute walkthrough script (Loom)

Record this over the Store Inventory tool. Do not ad-lib a second pricing brain.

0:00–1:00 — Who this is for (LGS owner, not Instagram). $147 vs one bad case buy.
1:00–3:00 — Category floors: sealed 28%, singles 50%, graded 25%, accessories 55%.
3:00–6:00 — Load the sample book. Point at Crown Zenith leftover: list above secondary, 210 days, liquidate.
6:00–8:00 — Prismatic ETB: days of supply, reorder trigger, in-band vs secondary.
8:00–10:00 — Dead-stock days 90 / 120 / 180. Say the line: waiting for the next set is how rooms fill.
10:00–12:00 — Sealed one-pager: invoice + freight is the floor.
12:00–14:00 — Import CSV into Notion/Airtable. Create the four views.
14:00–15:00 — CTA: run Flip Score on the next show buy; do not grade Crown Zenith hits.
`;
}
