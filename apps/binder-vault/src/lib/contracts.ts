import { z } from "zod";

/** Typed contracts for the Binder Vault API. zod schemas first (AGENTS.md). */

export const provenanceSchema = z.object({
  method: z.enum(["api", "user_upload", "inferred"]),
  source: z.string(),
  modelVersion: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
  verificationStatus: z.enum(["verified", "unverified"]),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/** A unified card result from any swappable data-source adapter. */
export const cardResultSchema = z.object({
  source: z.enum(["tcgdex", "pokemontcg"]),
  externalId: z.string(),
  name: z.string(),
  setName: z.string().nullable().default(null),
  number: z.string().nullable().default(null),
  rarity: z.string().nullable().default(null),
  imageSmall: z.string().nullable().default(null),
  imageHigh: z.string().nullable().default(null),
  priceMarket: z.number().nullable().default(null),
  priceCurrency: z.string().nullable().default(null),
  provenance: provenanceSchema,
});
export type CardResult = z.infer<typeof cardResultSchema>;

export const createBinderSchema = z.object({
  name: z.string().trim().min(1).max(120).default("Untitled Binder"),
  spineColor: z.string().default("#7a2331"),
  rows: z.number().int().min(1).max(8).default(3),
  cols: z.number().int().min(1).max(8).default(3),
  template: z.string().nullable().default(null),
});
export type CreateBinderInput = z.infer<typeof createBinderSchema>;

export const updateBinderSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  spineColor: z.string().optional(),
});

export const updatePageSchema = z.object({
  title: z.string().max(200).optional(),
  subtitle: z.string().max(400).optional(),
  tone: z.string().optional(),
});

/** Reorder pages by full ordered list of page ids for a binder. */
export const reorderPagesSchema = z.object({
  pageIds: z.array(z.string().min(1)).min(1),
});
export type ReorderPagesInput = z.infer<typeof reorderPagesSchema>;

/** Move or copy a page (and its cards) into another binder. */
export const transferPageSchema = z.object({
  targetBinderId: z.string().min(1),
  mode: z.enum(["move", "copy"]),
});
export type TransferPageInput = z.infer<typeof transferPageSchema>;

/** Placing a catalog card into a slot. */
export const placeCardSchema = z.object({
  kind: z.literal("card"),
  card: cardResultSchema,
});

/** Placing a user-uploaded image (already saved to media) into a slot. */
export const placeUploadSchema = z.object({
  kind: z.literal("upload"),
  imageLocal: z.string(),
  cardName: z.string().max(200).optional(),
});

/** Moving/swapping a card from another slot on the same page. */
export const moveSlotSchema = z.object({
  kind: z.literal("move"),
  fromSlotId: z.string(),
});

export const slotWriteSchema = z.discriminatedUnion("kind", [
  placeCardSchema,
  placeUploadSchema,
  moveSlotSchema,
]);
export type SlotWriteInput = z.infer<typeof slotWriteSchema>;

export type ApiSlot = {
  id: string;
  slotIndex: number;
  roleLabel: string;
  isCenter: boolean;
  onWishlist: boolean;
  owned: boolean;
  card: null | {
    source: string;
    externalId: string | null;
    name: string | null;
    setName: string | null;
    number: string | null;
    rarity: string | null;
    imageUrl: string | null;
    imageLocal: string | null;
    priceMarket: number | null;
    priceCurrency: string | null;
    /** Epoch ms of last successful price observation. */
    priceUpdatedAt: number | null;
    provenance: {
      method: string | null;
      source: string | null;
      modelVersion: string | null;
      confidence: number | null;
      verificationStatus: string | null;
    };
    addedAt: number | null;
  };
};

export const setWishlistSchema = z.object({
  onWishlist: z.boolean(),
});

export const setOwnedSchema = z.object({
  owned: z.boolean(),
});

/** Sync owned flags from VIP inventory by external_id. */
export const syncOwnedSchema = z.object({
  binderId: z.string().min(1).optional(),
});
export type SyncOwnedInput = z.infer<typeof syncOwnedSchema>;

export const syncOwnedResultSchema = z.object({
  matched: z.number().int().min(0),
  markedOwned: z.number().int().min(0),
  alreadyOwned: z.number().int().min(0),
  vipExternalIds: z.number().int().min(0),
  slotsChecked: z.number().int().min(0),
  provenance: provenanceSchema,
});
export type SyncOwnedResult = z.infer<typeof syncOwnedResultSchema>;

export const wishlistExportSchema = z.object({
  binderId: z.string().nullable().optional(),
  /** If true, only starred wishlist slots; if false, every filled slot in scope. */
  starredOnly: z.boolean().default(true),
  includeImages: z.boolean().default(true),
  includePrices: z.boolean().default(true),
  note: z.string().max(500).optional().default(""),
  contactName: z.string().max(120).optional().default(""),
});
export type WishlistExportInput = z.infer<typeof wishlistExportSchema>;

export type WishlistItem = {
  slotId: string;
  binderName: string;
  pageTitle: string;
  roleLabel: string;
  name: string;
  setName: string | null;
  number: string | null;
  rarity: string | null;
  priceMarket: number | null;
  priceCurrency: string | null;
  imageUrl: string | null;
  imageLocal: string | null;
};

export type ApiPage = {
  id: string;
  pageIndex: number;
  title: string;
  subtitle: string;
  tone: string;
  slots: ApiSlot[];
};

export type ApiBinder = {
  id: string;
  name: string;
  spineColor: string;
  rows: number;
  cols: number;
  template: string | null;
  createdAt: number;
  updatedAt: number;
  pages: ApiPage[];
};
