import type { ApiBinder, ApiPage } from "./contracts";

export type ValueLine = {
  slotId: string;
  pageIndex: number;
  pageTitle: string;
  slotIndex: number;
  roleLabel: string;
  name: string;
  setName: string | null;
  number: string | null;
  rarity: string | null;
  priceMarket: number | null;
  owned: boolean;
  onWishlist: boolean;
};

export type ValueTotals = {
  /** Cards included in the calc (selected, or all when selection empty). */
  count: number;
  pricedCount: number;
  unpricedCount: number;
  ownedCount: number;
  needCount: number;
  /** Sum of market prices for included cards (null prices count as 0). */
  totalMarket: number;
  ownedMarket: number;
  needMarket: number;
  /**
   * Net position: owned market − need market.
   * Positive ⇒ more value in-hand than still to buy (in this selection).
   */
  delta: number;
};

export function collectValueLines(
  binder: ApiBinder,
  scope: "page" | "binder",
  pageIndex: number,
): ValueLine[] {
  const pages: ApiPage[] =
    scope === "page"
      ? binder.pages[pageIndex]
        ? [binder.pages[pageIndex]!]
        : []
      : binder.pages;

  const lines: ValueLine[] = [];
  for (const page of pages) {
    for (const slot of page.slots) {
      if (!slot.card) continue;
      lines.push({
        slotId: slot.id,
        pageIndex: page.pageIndex,
        pageTitle: page.title.trim() || `Page ${page.pageIndex + 1}`,
        slotIndex: slot.slotIndex,
        roleLabel: slot.roleLabel,
        name: slot.card.name || "Unknown card",
        setName: slot.card.setName,
        number: slot.card.number,
        rarity: slot.card.rarity,
        priceMarket: slot.card.priceMarket,
        owned: slot.owned,
        onWishlist: slot.onWishlist,
      });
    }
  }
  return lines;
}

/** If `selectedIds` is empty, every line is included (full page/binder glance). */
export function computeValueTotals(
  lines: ValueLine[],
  selectedIds: ReadonlySet<string>,
): ValueTotals {
  const useSelection = selectedIds.size > 0;
  const included = useSelection ? lines.filter((l) => selectedIds.has(l.slotId)) : lines;

  let pricedCount = 0;
  let unpricedCount = 0;
  let ownedCount = 0;
  let needCount = 0;
  let totalMarket = 0;
  let ownedMarket = 0;
  let needMarket = 0;

  for (const line of included) {
    const price = typeof line.priceMarket === "number" ? line.priceMarket : 0;
    if (typeof line.priceMarket === "number") pricedCount++;
    else unpricedCount++;

    totalMarket += price;
    if (line.owned) {
      ownedCount++;
      ownedMarket += price;
    } else {
      needCount++;
      needMarket += price;
    }
  }

  return {
    count: included.length,
    pricedCount,
    unpricedCount,
    ownedCount,
    needCount,
    totalMarket,
    ownedMarket,
    needMarket,
    delta: ownedMarket - needMarket,
  };
}

/** Newest successful price observation across cards (null if none stamped). */
export function maxPriceUpdatedAt(
  binder: ApiBinder,
  scope: "page" | "binder",
  pageIndex: number,
): number | null {
  const pages: ApiPage[] =
    scope === "page"
      ? binder.pages[pageIndex]
        ? [binder.pages[pageIndex]!]
        : []
      : binder.pages;
  let max: number | null = null;
  for (const page of pages) {
    for (const slot of page.slots) {
      const t = slot.card?.priceUpdatedAt;
      if (typeof t === "number" && (max == null || t > max)) max = t;
    }
  }
  return max;
}

export function formatPriceAsOf(epochMs: number | null): string {
  if (epochMs == null) return "Prices as of — (none stamped yet)";
  const d = new Date(epochMs);
  const when = d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Prices as of ${when}`;
}

export function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n < 0) return `−${body}`;
  return body;
}

export function pocketCoord(slotIndex: number, cols: number): string {
  const row = Math.floor(slotIndex / cols) + 1;
  const col = (slotIndex % cols) + 1;
  return `R${row}·C${col}`;
}
