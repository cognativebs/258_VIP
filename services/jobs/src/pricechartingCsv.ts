import {
  PRICECHARTING_PRICE_KEYS,
  PriceChartingProductSchema,
  csvDollarsToPennies,
  penniesToUsd,
  type PriceChartingPriceKey,
  type PriceChartingProduct,
} from "@vip/core-model";

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parsePriceChartingCsv(text: string): PriceChartingProduct[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0] ?? "").map((h) => h.trim().toLowerCase());
  const products: PriceChartingProduct[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const row: Record<string, string | number | null> = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i];
      if (!key) continue;
      row[key] = cells[i]?.trim() ?? "";
    }
    const id = String(row.id ?? row["product-id"] ?? "").trim();
    const name = String(row["product-name"] ?? row["product name"] ?? "").trim();
    if (!id || !name) continue;
    const priced: Record<string, number | null> = {};
    for (const key of PRICECHARTING_PRICE_KEYS) {
      priced[key] = csvDollarsToPennies(row[key] ?? row[key.replace(/-/g, " ")]);
    }
    const parsed = PriceChartingProductSchema.safeParse({
      id,
      "product-name": name,
      "console-name": row["console-name"] || row.console || null,
      upc: row.upc || null,
      asin: row.asin || null,
      epid: row.epid || null,
      genre: row.genre || null,
      "release-date": row["release-date"] || null,
      "sales-volume": row["sales-volume"] || null,
      ...priced,
    });
    if (parsed.success) products.push(parsed.data);
  }
  return products;
}

export function mappedConditionCount(product: PriceChartingProduct): number {
  return PRICECHARTING_PRICE_KEYS.filter((key) => {
    const pennies = product[key as PriceChartingPriceKey];
    return pennies != null && pennies > 0;
  }).length;
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Vendor CSV convention: dollars. Inverse of parsePriceChartingCsv. */
export function productsToCsv(products: PriceChartingProduct[]): string {
  const headers = ["id", "product-name", "console-name", "upc", ...PRICECHARTING_PRICE_KEYS];
  const lines = [headers.join(",")];
  for (const product of products) {
    const cells = [
      csvCell(product.id),
      csvCell(product["product-name"]),
      csvCell(product["console-name"]),
      csvCell(product.upc),
      ...PRICECHARTING_PRICE_KEYS.map((key) => {
        const pennies = product[key];
        return pennies == null ? "" : penniesToUsd(pennies).toFixed(2);
      }),
    ];
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}
