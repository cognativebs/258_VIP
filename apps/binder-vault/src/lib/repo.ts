import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { eraByKey, CENTER_INDEX_3x3 } from "./templates";
import { fetchCardMarketPrice } from "./cards";
import type {
  ApiBinder,
  ApiPage,
  ApiSlot,
  CreateBinderInput,
  SlotWriteInput,
} from "./contracts";
import type { SlotRow } from "@/db/schema";

function uid(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
  );
}

function slotToApi(row: SlotRow): ApiSlot {
  const hasCard = !!row.source;
  return {
    id: row.id,
    slotIndex: row.slotIndex,
    roleLabel: row.roleLabel,
    isCenter: row.isCenter,
    onWishlist: !!row.onWishlist,
    owned: !!row.owned,
    card: hasCard
      ? {
          source: row.source as string,
          externalId: row.externalId,
          name: row.cardName,
          setName: row.setName,
          number: row.number,
          rarity: row.rarity,
          imageUrl: row.imageUrl,
          imageLocal: row.imageLocal,
          priceMarket: row.priceMarket,
          priceCurrency: row.priceCurrency,
          priceUpdatedAt: row.priceUpdatedAt ?? null,
          provenance: {
            method: row.provenanceMethod,
            source: row.provenanceSource,
            modelVersion: row.provenanceModelVersion,
            confidence: row.confidence,
            verificationStatus: row.verificationStatus,
          },
          addedAt: row.addedAt,
        }
      : null,
  };
}

async function assembleBinder(binderId: string): Promise<ApiBinder | null> {
  const db = await getDb();
  const binderRows = await db
    .select()
    .from(schema.binders)
    .where(eq(schema.binders.id, binderId))
    .limit(1);
  const binder = binderRows[0];
  if (!binder) return null;

  const pageRows = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.binderId, binderId))
    .orderBy(asc(schema.pages.pageIndex));

  const pages: ApiPage[] = [];
  for (const p of pageRows) {
    const slotRows = await db
      .select()
      .from(schema.slots)
      .where(eq(schema.slots.pageId, p.id))
      .orderBy(asc(schema.slots.slotIndex));
    pages.push({
      id: p.id,
      pageIndex: p.pageIndex,
      title: p.title,
      subtitle: p.subtitle,
      tone: p.tone,
      slots: slotRows.map(slotToApi),
    });
  }

  return {
    id: binder.id,
    name: binder.name,
    spineColor: binder.spineColor,
    rows: binder.rows,
    cols: binder.cols,
    template: binder.template,
    createdAt: binder.createdAt,
    updatedAt: binder.updatedAt,
    pages,
  };
}

async function createPageWithSlots(binderId: string, pageIndex: number): Promise<string> {
  const db = await getDb();
  const binderRows = await db
    .select()
    .from(schema.binders)
    .where(eq(schema.binders.id, binderId))
    .limit(1);
  const binder = binderRows[0];
  if (!binder) throw new Error("binder not found");

  const era = binder.rows === 3 && binder.cols === 3 ? eraByKey(binder.template) : null;
  const pageId = uid();
  await db.insert(schema.pages).values({
    id: pageId,
    binderId,
    pageIndex,
    title: era ? era.name : `Page ${pageIndex + 1}`,
    subtitle: era ? era.subtitle : "",
    tone: era ? era.tone : binder.spineColor,
    createdAt: Date.now(),
  });

  const count = binder.rows * binder.cols;
  const slotValues = [];
  for (let i = 0; i < count; i++) {
    const isCenter = !!era && i === CENTER_INDEX_3x3;
    slotValues.push({
      id: uid(),
      pageId,
      slotIndex: i,
      roleLabel: era ? era.roles[i] ?? "" : "",
      isCenter,
    });
  }
  await db.insert(schema.slots).values(slotValues);
  return pageId;
}

export async function listBinders(): Promise<ApiBinder[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.binders).orderBy(asc(schema.binders.createdAt));
  const out: ApiBinder[] = [];
  for (const b of rows) {
    const assembled = await assembleBinder(b.id);
    if (assembled) out.push(assembled);
  }
  return out;
}

export async function getBinder(id: string): Promise<ApiBinder | null> {
  return assembleBinder(id);
}

export async function createBinder(input: CreateBinderInput): Promise<ApiBinder> {
  const db = await getDb();
  const id = uid();
  const now = Date.now();
  await db.insert(schema.binders).values({
    id,
    name: input.name,
    spineColor: input.spineColor,
    rows: input.rows,
    cols: input.cols,
    template: input.template,
    createdAt: now,
    updatedAt: now,
  });
  await createPageWithSlots(id, 0);
  return (await assembleBinder(id))!;
}

export async function updateBinder(
  id: string,
  patch: { name?: string; spineColor?: string },
): Promise<ApiBinder | null> {
  const db = await getDb();
  const rows = await db.select().from(schema.binders).where(eq(schema.binders.id, id)).limit(1);
  const existing = rows[0];
  if (!existing) return null;
  await db
    .update(schema.binders)
    .set({
      name: patch.name ?? existing.name,
      spineColor: patch.spineColor ?? existing.spineColor,
      updatedAt: Date.now(),
    })
    .where(eq(schema.binders.id, id));
  return assembleBinder(id);
}

export async function deleteBinder(id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select().from(schema.binders).where(eq(schema.binders.id, id)).limit(1);
  if (!rows[0]) return false;
  const pageRows = await db.select().from(schema.pages).where(eq(schema.pages.binderId, id));
  for (const p of pageRows) {
    await db.delete(schema.slots).where(eq(schema.slots.pageId, p.id));
  }
  await db.delete(schema.pages).where(eq(schema.pages.binderId, id));
  await db.delete(schema.binders).where(eq(schema.binders.id, id));
  return true;
}

export async function addPage(binderId: string): Promise<ApiBinder | null> {
  const db = await getDb();
  const existing = await db.select().from(schema.pages).where(eq(schema.pages.binderId, binderId));
  await createPageWithSlots(binderId, existing.length);
  await db
    .update(schema.binders)
    .set({ updatedAt: Date.now() })
    .where(eq(schema.binders.id, binderId));
  return assembleBinder(binderId);
}

export async function deletePage(pageId: string): Promise<{ binderId: string } | null> {
  const db = await getDb();
  const rows = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId)).limit(1);
  const page = rows[0];
  if (!page) return null;
  const remaining = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.binderId, page.binderId));
  if (remaining.length <= 1) return { binderId: page.binderId };

  await db.delete(schema.slots).where(eq(schema.slots.pageId, pageId));
  await db.delete(schema.pages).where(eq(schema.pages.id, pageId));

  const rest = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.binderId, page.binderId))
    .orderBy(asc(schema.pages.pageIndex));
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].pageIndex !== i) {
      await db
        .update(schema.pages)
        .set({ pageIndex: i })
        .where(eq(schema.pages.id, rest[i].id));
    }
  }
  return { binderId: page.binderId };
}

export async function updatePage(
  pageId: string,
  patch: { title?: string; subtitle?: string; tone?: string },
): Promise<{ binderId: string } | null> {
  const db = await getDb();
  const rows = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId)).limit(1);
  const page = rows[0];
  if (!page) return null;
  await db
    .update(schema.pages)
    .set({
      title: patch.title ?? page.title,
      subtitle: patch.subtitle ?? page.subtitle,
      tone: patch.tone ?? page.tone,
    })
    .where(eq(schema.pages.id, pageId));
  return { binderId: page.binderId };
}

export type TransferPageResult =
  | {
      ok: true;
      sourceBinder: ApiBinder;
      targetBinder: ApiBinder;
      newPageId: string;
      mode: "move" | "copy";
      gridMismatch: boolean;
      droppedCards: number;
    }
  | { ok: false; error: string };

/**
 * Copy or move a page (title + slot cards) into another binder.
 * Target pocket grid wins: cards whose slotIndex doesn't fit are dropped
 * (counted in `droppedCards`) — prefer matching rows×cols binders.
 */
export async function transferPage(
  pageId: string,
  targetBinderId: string,
  mode: "move" | "copy",
): Promise<TransferPageResult> {
  const db = await getDb();
  const pageRows = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId)).limit(1);
  const page = pageRows[0];
  if (!page) return { ok: false, error: "Page not found" };

  if (page.binderId === targetBinderId) {
    return { ok: false, error: "Pick a different binder" };
  }

  const sourceBinderRows = await db
    .select()
    .from(schema.binders)
    .where(eq(schema.binders.id, page.binderId))
    .limit(1);
  const targetBinderRows = await db
    .select()
    .from(schema.binders)
    .where(eq(schema.binders.id, targetBinderId))
    .limit(1);
  const sourceBinderRow = sourceBinderRows[0];
  const targetBinderRow = targetBinderRows[0];
  if (!sourceBinderRow || !targetBinderRow) {
    return { ok: false, error: "Binder not found" };
  }

  const siblingPages = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.binderId, page.binderId));
  if (mode === "move" && siblingPages.length <= 1) {
    return {
      ok: false,
      error: "Can't move the only page — copy it, or add another page first",
    };
  }

  const sourceSlots = await db
    .select()
    .from(schema.slots)
    .where(eq(schema.slots.pageId, pageId))
    .orderBy(asc(schema.slots.slotIndex));

  const targetCount = targetBinderRow.rows * targetBinderRow.cols;
  const gridMismatch =
    sourceBinderRow.rows !== targetBinderRow.rows ||
    sourceBinderRow.cols !== targetBinderRow.cols;

  let droppedCards = 0;
  if (gridMismatch) {
    for (const s of sourceSlots) {
      if (s.source && s.slotIndex >= targetCount) droppedCards++;
    }
  }

  const targetPages = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.binderId, targetBinderId));
  const newPageIndex = targetPages.length;
  const newPageId = uid();

  await db.insert(schema.pages).values({
    id: newPageId,
    binderId: targetBinderId,
    pageIndex: newPageIndex,
    title: page.title,
    subtitle: page.subtitle,
    tone: page.tone,
    createdAt: Date.now(),
  });

  const byIndex = new Map(sourceSlots.map((s) => [s.slotIndex, s]));
  const newSlots = [];
  for (let i = 0; i < targetCount; i++) {
    const src = byIndex.get(i);
    const cardFields = src?.source ? extractCard(src) : EMPTY_CARD_FIELDS;
    newSlots.push({
      id: uid(),
      pageId: newPageId,
      slotIndex: i,
      roleLabel: src?.roleLabel ?? "",
      isCenter: src?.isCenter ?? false,
      ...cardFields,
    });
  }
  await db.insert(schema.slots).values(newSlots);

  if (mode === "move") {
    await db.delete(schema.slots).where(eq(schema.slots.pageId, pageId));
    await db.delete(schema.pages).where(eq(schema.pages.id, pageId));
    const rest = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.binderId, page.binderId))
      .orderBy(asc(schema.pages.pageIndex));
    for (let i = 0; i < rest.length; i++) {
      if (rest[i]!.pageIndex !== i) {
        await db
          .update(schema.pages)
          .set({ pageIndex: i })
          .where(eq(schema.pages.id, rest[i]!.id));
      }
    }
  }

  const now = Date.now();
  await db
    .update(schema.binders)
    .set({ updatedAt: now })
    .where(eq(schema.binders.id, page.binderId));
  await db
    .update(schema.binders)
    .set({ updatedAt: now })
    .where(eq(schema.binders.id, targetBinderId));

  const sourceBinder = await assembleBinder(page.binderId);
  const targetBinder = await assembleBinder(targetBinderId);
  if (!sourceBinder || !targetBinder) {
    return { ok: false, error: "Transfer saved but binders could not be reloaded" };
  }

  return {
    ok: true,
    sourceBinder,
    targetBinder,
    newPageId,
    mode,
    gridMismatch,
    droppedCards,
  };
}

/** Persist a new page order. `pageIds` must be a permutation of the binder's pages. */
export async function reorderPages(
  binderId: string,
  pageIds: string[],
): Promise<ApiBinder | null> {
  const db = await getDb();
  const binderRows = await db
    .select()
    .from(schema.binders)
    .where(eq(schema.binders.id, binderId))
    .limit(1);
  if (!binderRows[0]) return null;

  const existing = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.binderId, binderId))
    .orderBy(asc(schema.pages.pageIndex));
  if (existing.length !== pageIds.length) return null;

  const existingIds = new Set(existing.map((p) => p.id));
  if (pageIds.some((id) => !existingIds.has(id))) return null;
  if (new Set(pageIds).size !== pageIds.length) return null;

  // Two-pass update avoids unique collisions if a composite unique is added later.
  for (let i = 0; i < pageIds.length; i++) {
    await db
      .update(schema.pages)
      .set({ pageIndex: -(i + 1) })
      .where(eq(schema.pages.id, pageIds[i]!));
  }
  for (let i = 0; i < pageIds.length; i++) {
    await db
      .update(schema.pages)
      .set({ pageIndex: i })
      .where(eq(schema.pages.id, pageIds[i]!));
  }
  await db
    .update(schema.binders)
    .set({ updatedAt: Date.now() })
    .where(eq(schema.binders.id, binderId));
  return assembleBinder(binderId);
}

const EMPTY_CARD_FIELDS = {
  source: null,
  externalId: null,
  cardName: null,
  setName: null,
  number: null,
  rarity: null,
  imageUrl: null,
  imageLocal: null,
  priceMarket: null,
  priceCurrency: null,
  priceUpdatedAt: null,
  provenanceMethod: null,
  provenanceSource: null,
  provenanceModelVersion: null,
  confidence: null,
  verificationStatus: null,
  addedAt: null,
  onWishlist: false,
  owned: false,
} as const;

export async function writeSlot(
  slotId: string,
  input: SlotWriteInput,
): Promise<{ binderId: string } | null> {
  const db = await getDb();
  const slotRows = await db.select().from(schema.slots).where(eq(schema.slots.id, slotId)).limit(1);
  const slot = slotRows[0];
  if (!slot) return null;
  const pageRows = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.id, slot.pageId))
    .limit(1);
  const page = pageRows[0];
  if (!page) return null;

  if (input.kind === "card") {
    const c = input.card;
    // Search payloads often lack embedded TCGPlayer prices (new Mega sets).
    // Resolve market value on place so pockets don't land with a blank $—.
    let priceMarket = c.priceMarket;
    let priceCurrency = c.priceCurrency;
    let rarity = c.rarity;
    let provenanceSource = c.provenance.source;
    let provenanceMethod = c.provenance.method;
    let confidence = c.provenance.confidence;
    let verificationStatus = c.provenance.verificationStatus;

    if (priceMarket == null && c.source === "pokemontcg" && c.externalId) {
      try {
        const fresh = await fetchCardMarketPrice(c.externalId);
        if (fresh.priceMarket != null) {
          priceMarket = fresh.priceMarket;
          priceCurrency = fresh.priceCurrency;
          if (fresh.rarity) rarity = fresh.rarity;
          if (fresh.priceSource !== "none") {
            provenanceSource = fresh.priceSource;
            provenanceMethod = "api";
            verificationStatus = "verified";
            confidence = fresh.priceSource === "tcgplayer.com" ? 0.85 : 0.92;
          }
        } else if (fresh.rarity && !rarity) {
          rarity = fresh.rarity;
        }
      } catch {
        // Keep the card; price can be filled later via Sync Prices.
      }
    }

    const now = Date.now();
    await db
      .update(schema.slots)
      .set({
        source: c.source,
        externalId: c.externalId,
        cardName: c.name,
        setName: c.setName,
        number: c.number,
        rarity,
        imageUrl: c.imageHigh ?? c.imageSmall,
        imageLocal: null,
        priceMarket,
        priceCurrency,
        priceUpdatedAt: priceMarket != null ? now : null,
        provenanceMethod,
        provenanceSource,
        provenanceModelVersion: c.provenance.modelVersion,
        confidence,
        verificationStatus,
        addedAt: now,
        onWishlist: false,
        owned: false,
      })
      .where(eq(schema.slots.id, slotId));
  } else if (input.kind === "upload") {
    await db
      .update(schema.slots)
      .set({
        source: "upload",
        externalId: null,
        cardName: input.cardName ?? "User upload",
        setName: null,
        number: null,
        rarity: null,
        imageUrl: null,
        imageLocal: input.imageLocal,
        priceMarket: null,
        priceCurrency: null,
        priceUpdatedAt: null,
        provenanceMethod: "user_upload",
        provenanceSource: "local-file",
        provenanceModelVersion: null,
        confidence: null,
        verificationStatus: "unverified",
        addedAt: Date.now(),
        onWishlist: false,
        owned: false,
      })
      .where(eq(schema.slots.id, slotId));
  } else {
    // move: copy card fields from source slot; swap target back or clear source.
    const fromRows = await db
      .select()
      .from(schema.slots)
      .where(eq(schema.slots.id, input.fromSlotId))
      .limit(1);
    const from = fromRows[0];
    // Allow moves across pages in the same binder (UI may only show one page).
    if (!from) return { binderId: page.binderId };
    const fromPageRows = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.id, from.pageId))
      .limit(1);
    if (!fromPageRows[0] || fromPageRows[0].binderId !== page.binderId) {
      return { binderId: page.binderId };
    }
    const fromCard = extractCard(from);
    const targetCard = extractCard(slot);
    await db.update(schema.slots).set(fromCard).where(eq(schema.slots.id, slotId));
    await db
      .update(schema.slots)
      .set(slot.source ? targetCard : EMPTY_CARD_FIELDS)
      .where(eq(schema.slots.id, input.fromSlotId));
  }
  return { binderId: page.binderId };
}

function extractCard(row: SlotRow) {
  return {
    source: row.source,
    externalId: row.externalId,
    cardName: row.cardName,
    setName: row.setName,
    number: row.number,
    rarity: row.rarity,
    imageUrl: row.imageUrl,
    imageLocal: row.imageLocal,
    priceMarket: row.priceMarket,
    priceCurrency: row.priceCurrency,
    priceUpdatedAt: row.priceUpdatedAt,
    provenanceMethod: row.provenanceMethod,
    provenanceSource: row.provenanceSource,
    provenanceModelVersion: row.provenanceModelVersion,
    confidence: row.confidence,
    verificationStatus: row.verificationStatus,
    addedAt: row.addedAt,
    onWishlist: row.onWishlist,
    owned: row.owned,
  };
}

export async function setSlotWishlist(
  slotId: string,
  onWishlist: boolean,
): Promise<{ binderId: string } | null> {
  const db = await getDb();
  const slotRows = await db.select().from(schema.slots).where(eq(schema.slots.id, slotId)).limit(1);
  const slot = slotRows[0];
  if (!slot) return null;
  if (!slot.source) return null; // only filled pockets
  const pageRows = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.id, slot.pageId))
    .limit(1);
  const page = pageRows[0];
  if (!page) return null;
  await db
    .update(schema.slots)
    .set({ onWishlist })
    .where(eq(schema.slots.id, slotId));
  return { binderId: page.binderId };
}

export async function setSlotOwned(
  slotId: string,
  owned: boolean,
): Promise<{ binderId: string } | null> {
  const db = await getDb();
  const slotRows = await db.select().from(schema.slots).where(eq(schema.slots.id, slotId)).limit(1);
  const slot = slotRows[0];
  if (!slot) return null;
  if (!slot.source) return null;
  const pageRows = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.id, slot.pageId))
    .limit(1);
  const page = pageRows[0];
  if (!page) return null;
  await db.update(schema.slots).set({ owned }).where(eq(schema.slots.id, slotId));
  return { binderId: page.binderId };
}

export type VipOwnedMatch = {
  source: string;
  externalValue: string;
};

/** Mark filled slots owned when their external_id appears in VIP inventory matches. */
export async function syncOwnedFromExternalIds(
  matches: VipOwnedMatch[],
  opts?: { binderId?: string },
): Promise<{
  matched: number;
  markedOwned: number;
  alreadyOwned: number;
  slotsChecked: number;
  binder: ApiBinder | null;
}> {
  const db = await getDb();
  const keySet = new Set(
    matches.map((m) => `${m.source}:${m.externalValue}`),
  );
  const valueOnly = new Set(matches.map((m) => m.externalValue));

  let slots = await db.select().from(schema.slots);
  if (opts?.binderId) {
    const pages = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.binderId, opts.binderId));
    const pageIds = new Set(pages.map((p) => p.id));
    slots = slots.filter((s) => pageIds.has(s.pageId));
  }

  let matched = 0;
  let markedOwned = 0;
  let alreadyOwned = 0;
  let slotsChecked = 0;

  for (const slot of slots) {
    if (!slot.source || !slot.externalId) continue;
    slotsChecked += 1;
    const key = `${slot.source}:${slot.externalId}`;
    const hit = keySet.has(key) || valueOnly.has(slot.externalId);
    if (!hit) continue;
    matched += 1;
    if (slot.owned) {
      alreadyOwned += 1;
      continue;
    }
    await db
      .update(schema.slots)
      .set({
        owned: true,
        provenanceMethod: "api",
        provenanceSource: "vip-api",
        provenanceModelVersion: "vip-owned-sync@0.1.0",
        confidence: 0.7,
        verificationStatus: "unverified",
      })
      .where(eq(schema.slots.id, slot.id));
    markedOwned += 1;
  }

  const binder = opts?.binderId ? await assembleBinder(opts.binderId) : null;
  return { matched, markedOwned, alreadyOwned, slotsChecked, binder };
}

export type WishlistItemRow = {
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

/** Collect wishlist (or all filled) cards for PDF export. */
export async function collectWishlistItems(opts: {
  binderId?: string | null;
  starredOnly?: boolean;
}): Promise<WishlistItemRow[]> {
  const binders = opts.binderId
    ? [await assembleBinder(opts.binderId)].filter(Boolean)
    : await listBinders();
  const starredOnly = opts.starredOnly ?? true;
  const items: WishlistItemRow[] = [];

  for (const binder of binders) {
    if (!binder) continue;
    for (const page of binder.pages) {
      for (const slot of page.slots) {
        if (!slot.card) continue;
        if (starredOnly && !slot.onWishlist) continue;
        items.push({
          slotId: slot.id,
          binderName: binder.name,
          pageTitle: page.title || `Page ${page.pageIndex + 1}`,
          roleLabel: slot.roleLabel,
          name: slot.card.name || "Unknown card",
          setName: slot.card.setName,
          number: slot.card.number,
          rarity: slot.card.rarity,
          priceMarket: slot.card.priceMarket,
          priceCurrency: slot.card.priceCurrency,
          imageUrl: slot.card.imageUrl,
          imageLocal: slot.card.imageLocal,
        });
      }
    }
  }
  return items;
}

export async function clearSlot(slotId: string): Promise<{ binderId: string } | null> {
  const db = await getDb();
  const slotRows = await db.select().from(schema.slots).where(eq(schema.slots.id, slotId)).limit(1);
  const slot = slotRows[0];
  if (!slot) return null;
  const pageRows = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.id, slot.pageId))
    .limit(1);
  await db.update(schema.slots).set(EMPTY_CARD_FIELDS).where(eq(schema.slots.id, slotId));
  const page = pageRows[0];
  return page ? { binderId: page.binderId } : null;
}

export type PriceSyncReport = {
  binderId: string;
  pagesScanned: number;
  slotsChecked: number;
  updated: number;
  unchanged: number;
  failed: number;
  skipped: number;
};

/**
 * Refresh TCGplayer market prices for cards in a binder.
 * - `pageId`: sync that page only
 * - else first `firstPages` pages (default 5)
 * By default only fills slots that are still missing a price. Pass `force: true`
 * to refresh everything.
 */
export async function syncBinderPrices(
  binderId: string,
  opts: { firstPages?: number; pageId?: string | null; force?: boolean } = {},
): Promise<{ binder: ApiBinder; report: PriceSyncReport } | null> {
  const firstPages = opts.firstPages ?? 5;
  const force = opts.force ?? false;
  const binder = await assembleBinder(binderId);
  if (!binder) return null;

  const pages = opts.pageId
    ? binder.pages.filter((p) => p.id === opts.pageId)
    : binder.pages.slice(0, firstPages);
  if (opts.pageId && pages.length === 0) return null;
  const db = await getDb();
  const report: PriceSyncReport = {
    binderId,
    pagesScanned: pages.length,
    slotsChecked: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    skipped: 0,
  };

  type Job = { slotId: string; externalId: string; priceMarket: number | null; rarity: string | null };
  const jobs: Job[] = [];
  for (const page of pages) {
    for (const slot of page.slots) {
      const card = slot.card;
      if (!card) {
        report.skipped++;
        continue;
      }
      if (card.source !== "pokemontcg" || !card.externalId) {
        report.skipped++;
        continue;
      }
      if (!force && card.priceMarket != null) {
        report.unchanged++;
        continue;
      }
      report.slotsChecked++;
      jobs.push({
        slotId: slot.id,
        externalId: card.externalId,
        priceMarket: card.priceMarket,
        rarity: card.rarity,
      });
    }
  }

  const concurrency = 4;
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (job) => {
        try {
          const fresh = await fetchCardMarketPrice(job.externalId);
          const now = Date.now();
          // Never wipe a known price with a failed lookup.
          if (fresh.priceMarket == null) {
            if (fresh.rarity != null && fresh.rarity !== job.rarity) {
              await db
                .update(schema.slots)
                .set({ rarity: fresh.rarity })
                .where(eq(schema.slots.id, job.slotId));
              report.updated++;
              return;
            }
            report.failed++;
            return;
          }
          const priceChanged = fresh.priceMarket !== job.priceMarket;
          const rarityChanged = fresh.rarity != null && fresh.rarity !== job.rarity;
          if (!priceChanged && !rarityChanged) {
            // Successful observation — freshen stamp even when value is the same.
            await db
              .update(schema.slots)
              .set({ priceUpdatedAt: now })
              .where(eq(schema.slots.id, job.slotId));
            report.unchanged++;
            return;
          }
          await db
            .update(schema.slots)
            .set({
              priceMarket: fresh.priceMarket,
              priceCurrency: fresh.priceCurrency,
              priceUpdatedAt: now,
              ...(fresh.rarity ? { rarity: fresh.rarity } : {}),
              provenanceSource: fresh.priceSource,
              provenanceMethod: "api",
              verificationStatus: "verified",
              confidence: fresh.priceSource === "tcgplayer.com" ? 0.85 : 0.92,
            })
            .where(eq(schema.slots.id, job.slotId));
          report.updated++;
        } catch {
          report.failed++;
        }
      }),
    );
    if (i + concurrency < jobs.length) await new Promise((r) => setTimeout(r, 40));
  }

  await db
    .update(schema.binders)
    .set({ updatedAt: Date.now() })
    .where(eq(schema.binders.id, binderId));

  return { binder: (await assembleBinder(binderId))!, report };
}
