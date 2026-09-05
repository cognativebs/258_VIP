import { ACTIVE_LISTING_STATUSES } from "./constants.js";
import type { MarketplaceListing, SalesPathState, SellingDisposition } from "./schemas.js";

const PROTECTED: SellingDisposition[] = ["PC", "HOLD", "GRADE"];
const ACTIVE_LOT_STATES = new Set(["proposed", "accepted", "listed", "active"]);

export type LotMembership = {
  lotId: string;
  inventoryId: string;
  lotStatus: "proposed" | "accepted" | "listed" | "active" | "rejected" | "ended";
};

/**
 * One physical single-quantity asset cannot be on two incompatible sales paths.
 */
export function assertListingExclusivity(input: {
  inventoryId: string;
  quantity: number;
  salesPathState: SalesPathState;
  existingListings: MarketplaceListing[];
  lotMemberships: LotMembership[];
  next: { kind: "single" | "lot"; lotId?: string };
}): void {
  if (input.salesPathState === "sold") {
    throw new Error(`Holding ${input.inventoryId} is sold — do not relist`);
  }
  if (input.quantity !== 1) return;

  const activeSingles = input.existingListings.filter(
    (l) =>
      l.listingKind === "single" &&
      l.quantity === 1 &&
      (ACTIVE_LISTING_STATUSES as readonly string[]).includes(l.status),
  );
  const activeLots = input.lotMemberships.filter((m) => ACTIVE_LOT_STATES.has(m.lotStatus));

  if (input.next.kind === "single") {
    if (activeSingles.length > 0) {
      throw new Error(`Holding ${input.inventoryId} already has an active single listing`);
    }
    if (activeLots.length > 0) {
      throw new Error(`Holding ${input.inventoryId} is in an active lot and cannot list as a single`);
    }
  }

  if (input.next.kind === "lot") {
    if (activeSingles.length > 0) {
      throw new Error(`Holding ${input.inventoryId} has an active single listing and cannot join a lot`);
    }
    const otherLot = activeLots.find((m) => m.lotId !== input.next.lotId);
    if (otherLot) {
      throw new Error(`Holding ${input.inventoryId} already belongs to lot ${otherLot.lotId}`);
    }
  }
}

export function canEnterLot(disposition: SellingDisposition | null | undefined): boolean {
  if (!disposition) return true;
  return !PROTECTED.includes(disposition);
}

export function assertLotEligible(disposition: SellingDisposition | null | undefined, inventoryId: string): void {
  if (!canEnterLot(disposition)) {
    throw new Error(`Holding ${inventoryId} disposition ${disposition} cannot enter a lot`);
  }
}

export function nextSalesPath(kind: "single" | "lot"): SalesPathState {
  return kind === "single" ? "listed_single" : "listed_lot";
}
