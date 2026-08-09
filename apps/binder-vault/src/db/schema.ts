import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgSchema,
  text,
} from "drizzle-orm/pg-core";

/**
 * Binder Vault schema — Postgres `vault_tcg` (ADR 0007).
 *
 * Provenance is mandatory (AGENTS.md rule 2): every card placement records
 * source, method, model/rule version, confidence and verification status.
 * Inferred values are never stored as if verified.
 */

export const vaultTcg = pgSchema("vault_tcg");

export const binders = vaultTcg.table("binder", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  spineColor: text("spine_color").notNull().default("#7a2331"),
  rows: integer("rows").notNull().default(3),
  cols: integer("cols").notNull().default(3),
  template: text("template"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const pages = vaultTcg.table(
  "binder_page",
  {
    id: text("id").primaryKey(),
    binderId: text("binder_id")
      .notNull()
      .references(() => binders.id, { onDelete: "cascade" }),
    pageIndex: integer("page_index").notNull(),
    title: text("title").notNull().default(""),
    subtitle: text("subtitle").notNull().default(""),
    tone: text("tone").notNull().default("#7a2331"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    binderIdx: index("page_binder_idx").on(t.binderId),
  }),
);

export const slots = vaultTcg.table(
  "binder_slot",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    slotIndex: integer("slot_index").notNull(),
    roleLabel: text("role_label").notNull().default(""),
    isCenter: boolean("is_center").notNull().default(false),

    source: text("source"),
    externalId: text("external_id"),
    cardName: text("card_name"),
    setName: text("set_name"),
    number: text("number"),
    rarity: text("rarity"),
    imageUrl: text("image_url"),
    imageLocal: text("image_local"),
    priceMarket: doublePrecision("price_market"),
    priceCurrency: text("price_currency"),
    priceUpdatedAt: bigint("price_updated_at", { mode: "number" }),

    provenanceMethod: text("provenance_method"),
    provenanceSource: text("provenance_source"),
    provenanceModelVersion: text("provenance_model_version"),
    confidence: doublePrecision("confidence"),
    verificationStatus: text("verification_status"),

    addedAt: bigint("added_at", { mode: "number" }),
    onWishlist: boolean("on_wishlist").notNull().default(false),
    owned: boolean("owned").notNull().default(false),
  },
  (t) => ({
    pageIdx: index("slot_page_idx").on(t.pageId),
  }),
);

export const priceSnapshots = vaultTcg.table(
  "price_snapshot",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    slotId: text("slot_id")
      .notNull()
      .references(() => slots.id, { onDelete: "cascade" }),
    priceMarket: doublePrecision("price_market").notNull(),
    priceCurrency: text("price_currency").notNull().default("USD"),
    observedAt: bigint("observed_at", { mode: "number" }).notNull(),
    source: text("source").notNull(),
    ruleVersion: text("rule_version").notNull(),
  },
  (t) => ({
    slotIdx: index("price_snapshot_slot_idx").on(t.slotId, t.observedAt),
  }),
);

export type BinderRow = typeof binders.$inferSelect;
export type PageRow = typeof pages.$inferSelect;
export type SlotRow = typeof slots.$inferSelect;
