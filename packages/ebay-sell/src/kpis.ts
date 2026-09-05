import { roundMoney } from "./pricing.js";
import type { ListingMetricSnapshot, MarketplaceListing, MarketplaceOrder, MarketplaceOrderLine } from "./schemas.js";

export type EbayKpiSnapshot = {
  sales: {
    grossSales: number;
    netProceeds: number | null;
    salesCount: number;
    averageOrderValue: number | null;
    averageCardSalePrice: number | null;
    netIsEstimate: boolean;
  };
  inventory: {
    activeListings: number;
    unlistedSellable: number;
    staleListings: number;
    daysInInventoryAvg: number | null;
    sellThrough: number | null;
  };
  funnel: {
    impressions: number | null;
    views: number | null;
    viewRate: number | null;
    salesConversion: number | null;
    daysToSaleAvg: number | null;
  };
  economics: {
    grossMargin: number | null;
    netMargin: number | null;
    estimatedLaborMinutes: number;
    netPerLaborMinute: number | null;
    shippingCostPerRevenue: number | null;
    feesAreEstimates: true;
  };
};

export function computeEbayKpis(input: {
  listings: MarketplaceListing[];
  orders: MarketplaceOrder[];
  lines: MarketplaceOrderLine[];
  metrics: ListingMetricSnapshot[];
  unlistedSellable: number;
  laborMinutes?: number;
  costBasisTotal?: number;
  now?: Date;
}): EbayKpiSnapshot {
  const now = input.now ?? new Date();
  const sold = input.listings.filter((l) => l.status === "SOLD");
  const active = input.listings.filter((l) => l.status === "ACTIVE" || l.status === "PUBLISHED");
  const stale = active.filter((l) => {
    if (!l.listedAt) return false;
    return now.getTime() - l.listedAt.getTime() >= 21 * 86_400_000;
  });
  const gross = input.lines.reduce((s, l) => s + l.salePrice, 0);
  const nets = input.lines.map((l) => l.netProceeds).filter((n): n is number => n != null);
  const net = nets.length ? nets.reduce((s, n) => s + n, 0) : null;
  const aov = input.orders.length ? gross / input.orders.length : null;
  const avgCard = input.lines.length ? gross / input.lines.length : null;
  const impressions = sumNullable(input.metrics.map((m) => m.impressionsTotal));
  const views = sumNullable(input.metrics.map((m) => m.viewsTotal));
  const viewRate = impressions && views != null ? views / impressions : null;
  const salesConversion = views && sold.length ? sold.length / views : null;
  const dts = sold
    .map((l) => (l.listedAt && l.endedAt ? (l.endedAt.getTime() - l.listedAt.getTime()) / 86_400_000 : null))
    .filter((n): n is number => n != null);
  const daysToSaleAvg = dts.length ? dts.reduce((s, n) => s + n, 0) / dts.length : null;
  const labor = input.laborMinutes ?? sold.length * 4;
  const listedPlusSold = active.length + sold.length;
  const sellThrough = listedPlusSold ? sold.length / listedPlusSold : null;
  const shipping = input.lines.reduce((s, l) => s + (l.shippingAllocated ?? 0), 0);
  const cost = input.costBasisTotal ?? null;
  return {
    sales: {
      grossSales: roundMoney(gross),
      netProceeds: net == null ? null : roundMoney(net),
      salesCount: sold.length || input.lines.length,
      averageOrderValue: aov == null ? null : roundMoney(aov),
      averageCardSalePrice: avgCard == null ? null : roundMoney(avgCard),
      netIsEstimate: input.lines.some((l) => l.feeIsEstimate !== false),
    },
    inventory: {
      activeListings: active.length,
      unlistedSellable: input.unlistedSellable,
      staleListings: stale.length,
      daysInInventoryAvg: null,
      sellThrough,
    },
    funnel: {
      impressions,
      views,
      viewRate,
      salesConversion,
      daysToSaleAvg: daysToSaleAvg == null ? null : Number(daysToSaleAvg.toFixed(2)),
    },
    economics: {
      grossMargin: cost != null && gross > 0 ? Number(((gross - cost) / gross).toFixed(3)) : null,
      netMargin: net != null && gross > 0 ? Number((net / gross).toFixed(3)) : null,
      estimatedLaborMinutes: labor,
      netPerLaborMinute: net != null && labor > 0 ? roundMoney(net / labor) : null,
      shippingCostPerRevenue: gross > 0 ? Number((shipping / gross).toFixed(3)) : null,
      feesAreEstimates: true,
    },
  };
}

function sumNullable(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  if (!present.length) return null;
  return present.reduce((s, n) => s + n, 0);
}
