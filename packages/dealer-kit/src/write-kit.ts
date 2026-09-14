import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runFlipExamples } from "./examples.js";
import {
  courseSyllabusMd,
  compCheckDeskHtml,
  compCheckFieldHtml,
  flipExamplesCsv,
  flipScoreGuideHtml,
  gradingCalculatorXml,
  gradingFeesCsv,
  notionFlipTemplate,
  notionStoreBase,
  popRedFlagsCsv,
  sealedPricingHtml,
  storeSampleCsv,
  walkthroughScriptMd,
} from "./exports.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "products", "dealer-kit");

function write(rel: string, body: string) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  console.log(rel);
}

const runs = runFlipExamples();

write(
  "README.md",
  `# Dealer kit (IQVault / Temper)

Sellable tools generated from \`@vip/dealer-kit\`. Do not hand-edit numbers — re-run \`npm run export-kit -w @vip/dealer-kit\`.

| Product | Price | Folder |
| --- | --- | --- |
| Flip Score Deal Sheet | $37 | \`01-flip-score/\` |
| Break-Even Grading Calculator | $19 | \`02-grading-calculator/\` |
| 90-Second Comp Check | $12 | \`03-comp-check/\` |
| Card Store Inventory & Margin | $147 | \`04-store-inventory/\` |
| From Collector to Dealer | $197 | \`05-collector-to-dealer/\` (syllabus only) |

PriceCharting is a valuation adapter (idle without \`PRICECHARTING_API_TOKEN\`). It is not a catalog identifier.
`,
);
write("01-flip-score/NOTION_TEMPLATE.md", notionFlipTemplate(runs));
write("01-flip-score/examples.csv", flipExamplesCsv());
write("01-flip-score/HOW_TO_READ_THE_SCORE.html", flipScoreGuideHtml());
write("02-grading-calculator/grading-calculator.xls", gradingCalculatorXml());
write("02-grading-calculator/fees.csv", gradingFeesCsv());
write("02-grading-calculator/pop-red-flags.csv", popRedFlagsCsv());
write(
  "02-grading-calculator/README.md",
  `# Break-Even Grading Calculator ($19)

Open \`grading-calculator.xls\` in Excel or File → Import in Google Sheets (XML Spreadsheet 2003).

Tabs: Calculator · Fees (PSA / CGC / BGS) · Pop red flags · Lanes (bulk / value / express).

Yellow cells are inputs. Confirm fees at checkout — several cheap tiers are paused.
`,
);
write("03-comp-check/desk-laminate.html", compCheckDeskHtml());
write("03-comp-check/field-kit.html", compCheckFieldHtml());
write(
  "03-comp-check/README.md",
  `# 90-Second Comp Check ($12)

Print \`desk-laminate.html\` as a 1-page PDF. Screenshot \`field-kit.html\` on a phone.

Source order: eBay sold → 130point → PWCC → GoCollect → PriceCharting (last, guide only).
`,
);
write("04-store-inventory/NOTION_BASE.md", notionStoreBase());
write("04-store-inventory/store-sample.csv", storeSampleCsv());
write("04-store-inventory/sealed-pricing.html", sealedPricingHtml());
write("04-store-inventory/WALKTHROUGH_SCRIPT.md", walkthroughScriptMd());
write("05-collector-to-dealer/SYLLABUS.md", courseSyllabusMd());
