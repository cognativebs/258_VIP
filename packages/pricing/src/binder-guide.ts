import { z } from "zod";
import type { SqlRunner } from "./sync.js";

/**
 * Binder pocket prices from the PriceCharting guide VIP stores, shared by Binder Vault's Sync Prices
 * button and the scheduled `binder-price-refresh` job so there is one implementation of "refresh a
 * binder's prices" (backlog E).
 *
 * The guide is read through the VIP API (GET /api/pokemon/guide), which serves what the pokemon-prices
 * job stored. Nothing here calls the vendor, so the vendor's rate limits stay with pokemon-prices.
 * A card VIP has not priced yet keeps its pocket unchanged: a price is never invented.
 *
 * Every priced pocket gets one `vault_tcg.price_snapshot` row per guide day (time-series, AGENTS.md);
 * a second refresh on the same guide day is a no-op. Nothing here writes to `vault_market` (HS-2).
 */

export const GUIDE_SOURCE = "pricecharting guide via VIP";
export const GUIDE_RULE = "pricecharting-pokemon-cards@0.1.0";
/** `vault_tcg.price_snapshot.source` for guide rows. */
export const GUIDE_SNAPSHOT_SOURCE = "pricecharting";
export const BINDER_GUIDE_SYNC_VERSION = "binder-guide-sync@0.1.0";

export const GuidePriceSchema = z.object({
  latest: z.number(),
  low: z.number(),
  high: z.number(),
  /** YYYY-MM-DD guide day. */
  latestOn: z.string(),
  snapshots: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  note: z.string(),
});
export type GuidePrice = z.infer<typeof GuidePriceSchema>;

/** The provenance columns of `vault_tcg.binder_slot` as a guide refresh fills them. */
export const BinderSlotGuideProvenanceSchema = z.object({
  method: z.literal("api"),
  source: z.string(),
  modelVersion: z.string(),
  confidence: z.number().min(0).max(1),
  verificationStatus: z.literal("unverified"),
});
export type BinderSlotGuideProvenance = z.infer<typeof BinderSlotGuideProvenanceSchema>;

export const BinderPriceSyncReportSchema = z.object({
  binderId: z.string(),
  pagesScanned: z.number().int().nonnegative(),
  slotsChecked: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  /** Daily history rows recorded by this sync. */
  historyRowsNew: z.number().int().nonnegative(),
  historyRowsUpdated: z.number().int().nonnegative(),
  /** Newest priced day seen — the honest "prices as of". */
  newestObservedOn: z.string().nullable(),
});
export type BinderPriceSyncReport = z.infer<typeof BinderPriceSyncReportSchema>;

export type GuideFetcher = (ids: string[]) => Promise<Map<string, GuidePrice>>;

export type BinderGuideSyncOptions = {
  runner: SqlRunner;
  binderId: string;
  /** Sync that page only (null when the page is not in the binder). */
  pageId?: string | null;
  /** The first N pages by page_index; omitted or null = every page. Ignored with pageId. */
  firstPages?: number | null;
  fetchGuide: GuideFetcher;
  /**
   * Catalog rarity top-up for pockets missing one (Binder's local card index). Loaded only when the
   * binder has cards to price; null or a failed load means no top-up.
   */
  loadRarity?: (() => Promise<((externalId: string) => string | null) | null>) | null;
  /** Read and count only; no slot update, snapshot or binder stamp. */
  dryRun?: boolean;
  now?: () => number;
};

type GuideRange = {
  condition: string;
  low: number;
  high: number;
  latest: number;
  latestOn: string;
  snapshots: number;
  confidence: number;
  note: string;
};

export const DEFAULT_VIP_API = "http://127.0.0.1:8787";

/** The ungraded (NM-assumed) range VIP holds for each id; ids without one are absent. Never throws. */
export async function fetchGuidePrices(
  ids: ReadonlyArray<string>,
  opts: { apiBase?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Map<string, GuidePrice>> {
  const out = new Map<string, GuidePrice>();
  const unique = [...new Set(ids.filter(Boolean))];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiBase = opts.apiBase ?? process.env.VIP_API_URL ?? DEFAULT_VIP_API;
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 2000);
    try {
      // `cache: "no-store"` keeps Next.js from caching the call inside Binder's route handlers.
      const init = { cache: "no-store", signal: ac.signal } as RequestInit;
      const res = await fetchImpl(`${apiBase}/api/pokemon/guide?ids=${encodeURIComponent(chunk.join(","))}`, init);
      if (!res.ok) continue;
      const body = (await res.json()) as { cards?: { externalId: string; ranges: GuideRange[] }[] };
      for (const card of body.cards ?? []) {
        const nm = card.ranges.find((r) => r.condition === "NM");
        if (!nm) continue;
        out.set(card.externalId, {
          latest: nm.latest,
          low: nm.low,
          high: nm.high,
          latestOn: nm.latestOn,
          snapshots: nm.snapshots,
          confidence: nm.confidence,
          note: nm.note,
        });
      }
    } catch {
      /* VIP down or slow: the cards stay unpriced, never guessed */
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

export function guideRangeLabel(g: GuidePrice): string {
  const range = g.low === g.high ? `$${g.latest.toFixed(2)}` : `$${g.low.toFixed(2)}–$${g.high.toFixed(2)}`;
  return `${range} · ${g.snapshots} snapshot${g.snapshots === 1 ? "" : "s"} to ${g.latestOn} · NM assumed · unverified`;
}

/** A vendor guide with NM assumed: always unverified; the range travels in the source label. */
export function guideProvenance(g: GuidePrice): BinderSlotGuideProvenance {
  return {
    method: "api",
    source: `${GUIDE_SOURCE} (${guideRangeLabel(g)})`,
    modelVersion: GUIDE_RULE,
    confidence: g.confidence,
    verificationStatus: "unverified",
  };
}

export function guideDayMs(observedOn: string): number {
  return Date.parse(`${observedOn}T00:00:00Z`);
}

/**
 * One price_snapshot row per pocket per guide day; a second write of the same day is a no-op (false).
 * With dryRun it only reports whether the row would be new.
 */
export async function insertGuideSnapshot(
  runner: SqlRunner,
  slotId: string,
  observedOn: string,
  price: number,
  opts: { dryRun?: boolean } = {},
): Promise<boolean> {
  const observedAt = guideDayMs(observedOn);
  const existing = await runner(
    `SELECT 1 FROM vault_tcg.price_snapshot WHERE slot_id = $1 AND source = $2 AND observed_at = $3 LIMIT 1`,
    [slotId, GUIDE_SNAPSHOT_SOURCE, observedAt],
  );
  if (existing.rows.length) return false;
  if (opts.dryRun) return true;
  await runner(
    `INSERT INTO vault_tcg.price_snapshot (slot_id, price_market, price_currency, observed_at, source, rule_version)
     VALUES ($1, $2, 'USD', $3, $4, $5)`,
    [slotId, price, observedAt, GUIDE_SNAPSHOT_SOURCE, GUIDE_RULE],
  );
  return true;
}

/**
 * Refresh one binder's pocket prices from the guide. Returns null when the binder (or the requested
 * page) does not exist. One guide lookup per card, even when a card fills several pockets.
 */
export async function syncBinderGuidePrices(opts: BinderGuideSyncOptions): Promise<BinderPriceSyncReport | null> {
  const { runner, binderId } = opts;
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? Date.now;

  const binder = await runner(`SELECT 1 FROM vault_tcg.binder WHERE id = $1`, [binderId]);
  if (!binder.rows.length) return null;

  const pageRows = await runner(
    `SELECT id FROM vault_tcg.binder_page WHERE binder_id = $1 ORDER BY page_index ASC`,
    [binderId],
  );
  let pageIds = pageRows.rows.map((r) => String(r.id));
  if (opts.pageId) {
    pageIds = pageIds.filter((id) => id === opts.pageId);
    if (!pageIds.length) return null;
  } else if (opts.firstPages != null) {
    pageIds = pageIds.slice(0, opts.firstPages);
  }

  const report: BinderPriceSyncReport = {
    binderId,
    pagesScanned: pageIds.length,
    slotsChecked: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    skipped: 0,
    historyRowsNew: 0,
    historyRowsUpdated: 0,
    newestObservedOn: null,
  };

  const targets = new Map<string, { slotIds: string[]; rarity: string | null }>();
  for (const pageId of pageIds) {
    const slots = await runner(
      `SELECT id, source, external_id, rarity FROM vault_tcg.binder_slot WHERE page_id = $1 ORDER BY slot_index ASC`,
      [pageId],
    );
    for (const s of slots.rows) {
      const source = s.source == null ? null : String(s.source);
      const externalId = s.external_id == null ? "" : String(s.external_id);
      if (source !== "pokemontcg" || !externalId) {
        report.skipped++;
        continue;
      }
      report.slotsChecked++;
      const entry = targets.get(externalId);
      if (entry) entry.slotIds.push(String(s.id));
      else targets.set(externalId, { slotIds: [String(s.id)], rarity: s.rarity == null ? null : String(s.rarity) });
    }
  }

  if (targets.size > 0) {
    const guide = await opts.fetchGuide([...targets.keys()]);
    const rarityFor = opts.loadRarity ? await opts.loadRarity().catch(() => null) : null;
    const stamp = now();
    for (const [externalId, { slotIds, rarity }] of targets) {
      const g = guide.get(externalId);
      // Rarity is catalog metadata: top it up from the card index where it is missing.
      const indexRarity = !rarity && rarityFor ? rarityFor(externalId) : null;
      if (!g) {
        report.unchanged += slotIds.length;
        if (indexRarity && !dryRun) {
          for (const slotId of slotIds) {
            await runner(`UPDATE vault_tcg.binder_slot SET rarity = $1 WHERE id = $2`, [indexRarity, slotId]);
          }
        }
        continue;
      }
      const p = guideProvenance(g);
      if (!report.newestObservedOn || g.latestOn > report.newestObservedOn) report.newestObservedOn = g.latestOn;
      for (const slotId of slotIds) {
        if (!dryRun) {
          await runner(
            `UPDATE vault_tcg.binder_slot
                SET price_market = $1, price_currency = 'USD', price_updated_at = $2,
                    provenance_method = $3, provenance_source = $4, provenance_model_version = $5,
                    confidence = $6, verification_status = $7,
                    rarity = COALESCE($8, rarity)
              WHERE id = $9`,
            [
              g.latest,
              guideDayMs(g.latestOn) || stamp,
              p.method,
              p.source,
              p.modelVersion,
              p.confidence,
              p.verificationStatus,
              indexRarity,
              slotId,
            ],
          );
        }
        report.updated++;
        if (await insertGuideSnapshot(runner, slotId, g.latestOn, g.latest, { dryRun })) report.historyRowsNew++;
        else report.historyRowsUpdated++;
      }
    }
  }

  if (!dryRun) {
    await runner(`UPDATE vault_tcg.binder SET updated_at = $1 WHERE id = $2`, [now(), binderId]);
  }
  return report;
}
