/**
 * VaultOS Pricing Service — THE SWAP POINT (from vaultos-acquisition-v2.jsx)
 *
 * getPricing() takes an identified card and returns market data + comps.
 * DEMO: mock comps grounded in IQVault catalog market windows.
 * PROD: call @vip/signals EbayBrowseAdapter (+ toPricingSeamResult) for active asks /
 *       liquidity proxy; later swap MarketCompsAdapter impl for sold aggregator /
 *       Marketplace Insights when approved. Same return contract — nothing downstream changes.
 *
 * Return contract (keep identical when swapping backends):
 *   { marketValue, low, high, comps: [{ price, date, title }], source, confidence }
 */

const COMP_DATES = ["2d ago", "5d ago", "9d ago", "14d ago", "21d ago", "28d ago"];

function seededJitter(seed, i, spread) {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * spread * 2;
}

function hashId(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return Math.abs(h);
}

/**
 * Demo pricing — synthesizes sold comps from catalog sample_size + market value.
 */
export function mockPricingFromCatalog(card, getAsset) {
  const asset = card.assetId ? getAsset(card.assetId) : null;
  const m = asset?.market?.raw || asset?.market?.[Object.keys(asset?.market || {})[0]];
  const mv = m?.price ?? card.marketValue ?? 0;
  const sample = m?.sample_size ?? 6;
  const liquidity = m?.liquidity ?? 50;

  const spreadPct = liquidity >= 70 ? 0.1 : liquidity >= 40 ? 0.18 : 0.28;
  const spread = mv * spreadPct;
  const low = Math.round(Math.max(0, mv - spread) * 100) / 100;
  const high = Math.round((mv + spread) * 100) / 100;

  const compCount = Math.min(6, Math.max(3, Math.floor(sample / 6) + 2));
  const seed = hashId(card.assetId || card.name);

  const comps = Array.from({ length: compCount }, (_, i) => ({
    price: Math.round(Math.max(0.5, mv + seededJitter(seed, i, spread)) * 100) / 100,
    date: COMP_DATES[i] ?? `${(i + 1) * 5}d ago`,
    title: `${card.name.slice(0, 48)} — sold`,
  }));

  const confidence = Math.min(96, Math.round(35 + sample * 1.1 + (liquidity >= 65 ? 15 : 0)));

  return {
    marketValue: mv,
    low,
    high,
    comps,
    source: sample >= 20 ? "eBay sold + marketplace, last 30d" : "thin comps — verify by eye",
    confidence,
  };
}

/**
 * Production entry point. Swap implementation here; downstream stays unchanged.
 */
export async function getPricing(card, getAsset) {
  await new Promise((r) => setTimeout(r, 120));
  return mockPricingFromCatalog(card, getAsset);
}

export function mergePricing(card, pricing) {
  return {
    ...card,
    marketValue: pricing.marketValue ?? card.marketValue,
    priceLow: pricing.low ?? null,
    priceHigh: pricing.high ?? null,
    comps: pricing.comps ?? [],
    priceSource: pricing.source ?? "unknown",
    priceConfidence: pricing.confidence ?? 30,
  };
}

export function priceConfidenceLabel(score) {
  if (score >= 70) return { label: "VERIFIED", className: "conf-verified" };
  if (score >= 45) return { label: "MODERATE", className: "conf-moderate" };
  return { label: "LOW CONF", className: "conf-low" };
}
