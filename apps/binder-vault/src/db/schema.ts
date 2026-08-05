import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

/**
 * Binder Vault local schema.
 *
 * Provenance is mandatory (AGENTS.md rule 2): every card placement records
 * source, method, model/rule version, confidence and verification status.
 * Inferred values are never stored as if verified.
 */

export const binders = sqliteTable("binder", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  spineColor: text("spine_color").notNull().default("#7a2331"),
  rows: integer("rows").notNull().default(3),
  cols: integer("cols").notNull().default(3),
  template: text("template"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const pages = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    binderIdx: index("page_binder_idx").on(t.binderId),
  }),
);

export const slots = sqliteTable(
  "binder_slot",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    slotIndex: integer("slot_index").notNull(),
    roleLabel: text("role_label").notNull().default(""),
    isCenter: integer("is_center", { mode: "boolean" }).notNull().default(false),

    // --- Card placement (nullable when the pocket is empty) ---
    source: text("source"), // 'tcgdex' | 'pokemontcg' | 'upload'
    externalId: text("external_id"),
    cardName: text("card_name"),
    setName: text("set_name"),
    number: text("number"),
    rarity: text("rarity"),
    imageUrl: text("image_url"), // remote high-res source URL
    imageLocal: text("image_local"), // cached filename under .data/media
    priceMarket: real("price_market"),
    priceCurrency: text("price_currency"),
    /** Epoch ms when priceMarket was last successfully observed (null = never priced). */
    priceUpdatedAt: integer("price_updated_at"),

    // --- Provenance (mandatory on any derived/placed data) ---
    provenanceMethod: text("provenance_method"), // 'api' | 'user_upload' | 'inferred'
    provenanceSource: text("provenance_source"), // source id or URL
    provenanceModelVersion: text("provenance_model_version"),
    confidence: real("confidence"),
    verificationStatus: text("verification_status"), // 'verified' | 'unverified'

    addedAt: integer("added_at"),

    /** Marked for store wishlist / PDF export. */
    onWishlist: integer("on_wishlist", { mode: "boolean" }).notNull().default(false),

    /** Physically owned — used by the page/binder value calculator. */
    owned: integer("owned", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    pageIdx: index("slot_page_idx").on(t.pageId),
  }),
);

export type BinderRow = typeof binders.$inferSelect;
export type PageRow = typeof pages.$inferSelect;
export type SlotRow = typeof slots.$inferSelect;
