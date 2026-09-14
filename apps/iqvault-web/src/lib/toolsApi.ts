import { apiGet, apiPost } from "./api";

export const TOOL_EXPORT = {
  flipExamples: "/api/vip/api/tools/export/flip-examples.csv",
  flipNotion: "/api/vip/api/tools/export/flip-notion.md",
  flipGuide: "/api/vip/api/tools/export/flip-guide.html",
  gradingXls: "/api/vip/api/tools/export/grading-calculator.xls",
  compDesk: "/api/vip/api/tools/export/comp-desk.html",
  compField: "/api/vip/api/tools/export/comp-field.html",
  storeNotion: "/api/vip/api/tools/export/store-notion.md",
  sealed: "/api/vip/api/tools/export/sealed-pricing.html",
  walkthrough: "/api/vip/api/tools/export/store-walkthrough.md",
} as const;

export type ToolsCatalog = {
  version: string;
  pricecharting: { configured: boolean; tokenEnv: string; note: string };
  products: { id: string; title: string; priceUsd: number; href: string; note?: string }[];
};

export function loadCatalog() {
  return apiGet<ToolsCatalog>("/api/tools/catalog");
}

export function scoreFlip(body: unknown) {
  return apiPost<Record<string, unknown>>("/api/tools/flip-score", body);
}

export function loadFlipExamples() {
  return apiGet<{ examples: { example: Record<string, unknown>; result: Record<string, unknown> }[] }>(
    "/api/tools/flip-score/examples",
  );
}

export function scoreGrading(body: unknown) {
  return apiPost<Record<string, unknown>>("/api/tools/grading-breakeven", body);
}

export function loadFees() {
  return apiGet<{ tiers: Record<string, unknown>[] }>("/api/tools/grading-fees?includePaused=1");
}

export function loadCompCheck() {
  return apiGet<{
    title: string;
    timeBudgetSeconds: number;
    steps: string[];
    sources: { order: number; name: string; url: string; useFor: string; caveat: string }[];
    redFlags: { id: string; title: string; tells: string[]; doInstead: string }[];
  }>("/api/tools/comp-check");
}

export function scoreStore(skus?: unknown) {
  return apiPost<{
    rows: Record<string, unknown>[];
    reorderCount: number;
    liquidateCount: number;
    belowMarginCount: number;
  }>("/api/tools/store-inventory", skus ? { skus } : {});
}

export function lookupPriceCharting(q: string, category: string) {
  const qs = new URLSearchParams({ q, category, list: "1" });
  return apiGet<{
    idle: boolean;
    emptyReason?: string | null;
    products: {
      id: string;
      productName: string;
      consoleName: string;
      prices: Record<string, number | null>;
      provenance: { notes?: string };
    }[];
  }>(`/api/tools/pricecharting?${qs.toString()}`, 15000);
}
