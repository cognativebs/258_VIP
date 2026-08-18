import { randomUUID } from "node:crypto";
import { round2 } from "./math.js";
import {
  BinderPageCompletionSchema,
  BinderPageSchema,
  BinderSlotSchema,
  CollectionGoalSchema,
  type BinderPage,
  type BinderPageCompletion,
  type BinderPageType,
  type BinderSlot,
  type BinderSlotTier,
  type CollectionGoal,
  type CollectionGoalType,
} from "./schemas.js";

export class BinderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinderError";
  }
}

export function createCollectionGoal(input: {
  id?: string;
  name: string;
  goalType: CollectionGoalType;
  description?: string | null;
  createdAt?: Date;
}): CollectionGoal {
  return CollectionGoalSchema.parse({
    id: input.id ?? randomUUID(),
    name: input.name,
    goalType: input.goalType,
    description: input.description ?? null,
    createdAt: input.createdAt ?? new Date(),
  });
}

export function createBinderPage(input: {
  id?: string;
  expansionId?: string | null;
  pageType: BinderPageType;
  collectionGoalId?: string | null;
  slots?: BinderSlot[];
}): BinderPage {
  return BinderPageSchema.parse({
    id: input.id ?? randomUUID(),
    expansionId: input.expansionId ?? null,
    pageType: input.pageType,
    collectionGoalId: input.collectionGoalId ?? null,
    slots: input.slots ?? [],
  });
}

export function addBinderSlot(
  page: BinderPage,
  input: {
    id?: string;
    slotNumber: number;
    assetId: string;
    tier: BinderSlotTier;
    isMuseumAnchor?: boolean;
  },
): BinderPage {
  if (page.slots.some((s) => s.slotNumber === input.slotNumber)) {
    throw new BinderError(`Slot ${input.slotNumber} already exists on this page`);
  }
  const isMuseumAnchor = input.isMuseumAnchor ?? input.tier === "museum_anchor";
  if (isMuseumAnchor && input.tier !== "museum_anchor") {
    throw new BinderError("isMuseumAnchor requires tier museum_anchor");
  }
  const slot = BinderSlotSchema.parse({
    id: input.id ?? randomUUID(),
    binderPageId: page.id,
    slotNumber: input.slotNumber,
    assetId: input.assetId,
    tier: input.tier,
    isMuseumAnchor,
  });
  return BinderPageSchema.parse({ ...page, slots: [...page.slots, slot] });
}

/**
 * v1 heuristic matching vault_core.binder_page_completion:
 * complete if 0 missing; rip_candidate if >=85% filled; else buy_singles.
 */
export function binderPageCompletion(
  page: BinderPage,
  ownedAssetIds: ReadonlySet<string>,
): BinderPageCompletion {
  const total = page.slots.length;
  const filled = page.slots.filter((s) => ownedAssetIds.has(s.assetId)).length;
  const missing = total - filled;
  const pct = total === 0 ? 0 : round2((filled / total) * 100);
  const ripVsSinglesRecommendation =
    missing === 0 ? "complete" : filled / Math.max(total, 1) >= 0.85 ? "rip_candidate" : "buy_singles";
  return BinderPageCompletionSchema.parse({
    binderPageId: page.id,
    pageType: page.pageType,
    totalSlots: total,
    filledSlots: filled,
    missingSlots: missing,
    completionPct: pct,
    ripVsSinglesRecommendation,
  });
}
