import type { ApiHolding } from "../holdings.js";
import { ebaySoldAdapter } from "./ebaySold.js";
import { tcgplayerMarketAdapter } from "./tcgplayerMarket.js";
import type { CompSale, CompsAdapter, CompsAdapterResult } from "./types.js";

export type { CompSale, CompsAdapter, CompsAdapterResult } from "./types.js";
export { ebaySoldAdapter } from "./ebaySold.js";
export { tcgplayerMarketAdapter } from "./tcgplayerMarket.js";

/** Engine-facing sale shape (subset of CompSale). */
export type EngineSaleComp = {
  id: string;
  price: number;
  saleDate: Date;
  source: string;
};

const DEFAULT_ADAPTERS: CompsAdapter[] = [ebaySoldAdapter, tcgplayerMarketAdapter];

/** Fixture adapter — tests only. Activated by VIP_COMPS_USE_FIXTURE=1. */
export function fixtureCompsAdapter(sales: CompSale[]): CompsAdapter {
  return {
    id: "fixture",
    label: "Fixture comps (tests)",
    matches: () => true,
    fetchComps: async () => ({ adapterId: "fixture", sales }),
  };
}

export async function fetchCompsForHolding(
  holding: ApiHolding,
  adapters: CompsAdapter[] = DEFAULT_ADAPTERS,
): Promise<{ sales: EngineSaleComp[]; adapters: CompsAdapterResult[] }> {
  // Explicit test seam — never a silent production fallback with invented prices.
  if (process.env.VIP_COMPS_USE_FIXTURE === "1") {
    const raw = process.env.VIP_COMPS_FIXTURE_JSON;
    const parsed = raw ? (JSON.parse(raw) as CompSale[]) : [];
    const sales = parsed.map(toSaleComp);
    return {
      sales,
      adapters: [{ adapterId: "fixture", sales: parsed }],
    };
  }

  const applicable = adapters.filter((a) => a.matches(holding));
  if (!applicable.length) {
    return {
      sales: [],
      adapters: [
        {
          adapterId: "none",
          sales: [],
          emptyReason: "no comps adapter matches this holding",
        },
      ],
    };
  }

  const results = await Promise.all(applicable.map((a) => a.fetchComps(holding)));
  const sales = results.flatMap((r) => r.sales.map(toSaleComp));
  // Dedup by id so two adapters cannot double-count the same observation.
  const byId = new Map(sales.map((s) => [s.id, s]));
  return { sales: [...byId.values()], adapters: results };
}

function toSaleComp(c: CompSale): EngineSaleComp {
  return {
    id: c.id,
    price: c.price,
    saleDate: c.saleDate instanceof Date ? c.saleDate : new Date(c.saleDate),
    source: c.source,
  };
}
