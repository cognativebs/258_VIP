import { createHash } from "node:crypto";
import {
  conditionKeyFromTitle,
  HUNT_MARKET_RULE,
  huntAlertBand,
  huntSearchQuery,
  huntTitleMatch,
  isAlertable,
  isLotTitle,
  type HuntAsk,
  type HuntItemMarket,
  type HuntPriceBand,
} from "@vip/core-model";
import { resolveEbayAccessToken } from "./comps/ebayAuth.js";
import type { Queryable } from "./huntStore.js";

/**
 * "Check eBay now" for a hunt (operator click only — nothing schedules this). Each open item is
 * one Browse search; the raw reply is kept in raw_snapshots, every ask becomes a
 * hunt_listing_observation, and an exact, ungraded, single-book ask inside the item's band (or
 * under target) becomes one hunt_band_alert per listing.
 */
export const HUNT_BROWSE_SOURCE = "ebay_browse";
const BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

export type HuntBrowseResult = { ok: true; rawJson: string } | { ok: false; error: string; fatal: boolean };
export type HuntBrowseFetch = (query: string) => Promise<HuntBrowseResult>;

export const ebayHuntBrowse: HuntBrowseFetch = async (query) => {
  const auth = await resolveEbayAccessToken();
  if ("error" in auth) return { ok: false, error: auth.error, fatal: true };
  const params = new URLSearchParams({ q: query, limit: "25", filter: "buyingOptions:{FIXED_PRICE|AUCTION}", sort: "price" });
  try {
    const res = await fetch(`${BROWSE_URL}?${params}`, {
      headers: { Authorization: `Bearer ${auth.token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
      signal: AbortSignal.timeout(Number(process.env.VIP_COMPS_TIMEOUT_MS ?? 8000)),
    });
    const rawJson = await res.text();
    if (!res.ok) return { ok: false, error: `eBay HTTP ${res.status}`, fatal: res.status === 401 || res.status === 403 || res.status === 429 };
    return { ok: true, rawJson };
  } catch (e) {
    return { ok: false, error: `eBay request failed: ${e instanceof Error ? e.message : String(e)}`, fatal: false };
  }
};

type Summary = { itemId?: string; title?: string; price?: { value?: string; currency?: string }; itemWebUrl?: string };

export function asksFromBrowse(rawJson: string, details: Record<string, unknown>): HuntAsk[] {
  let body: { itemSummaries?: Summary[] };
  try {
    body = JSON.parse(rawJson) as { itemSummaries?: Summary[] };
  } catch {
    return [];
  }
  return (body.itemSummaries ?? []).flatMap((s) => {
    const askPrice = Number(s.price?.value);
    if (!s.itemId || !s.title || !Number.isFinite(askPrice) || askPrice <= 0) return [];
    if (s.price?.currency && s.price.currency !== "USD") return [];
    return [
      {
        listingId: s.itemId,
        askPrice,
        title: s.title,
        url: s.itemWebUrl ?? null,
        conditionKey: conditionKeyFromTitle(s.title),
        titleMatch: huntTitleMatch(details, s.title),
        isLot: isLotTitle(s.title),
      },
    ];
  });
}

export type HuntEbayCheckResult = {
  huntId: string;
  checked: number;
  skipped: { itemId: string; reason: string }[];
  listings: number;
  strongListings: number;
  newAlerts: number;
  stoppedReason: string | null;
  errors: { itemId: string; error: string }[];
};

async function insertSnapshot(db: Queryable, payload: string, recordCount: number): Promise<string | null> {
  const hash = createHash("sha256").update(payload).digest("hex");
  const inserted = await db.query(
    `INSERT INTO vault_evidence.raw_snapshots
       (source, content_hash, content_type, payload, byte_length, record_count,
        prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification)
     VALUES ($1, $2, 'application/json', $3, $4, $5, $1, 'observed', $6, 1.0, 'verified')
     ON CONFLICT (content_hash) DO NOTHING
     RETURNING id`,
    [HUNT_BROWSE_SOURCE, hash, payload, Buffer.byteLength(payload), recordCount, HUNT_MARKET_RULE],
  );
  if (inserted.rows[0]) return String(inserted.rows[0].id);
  const existing = await db.query(`SELECT id FROM vault_evidence.raw_snapshots WHERE content_hash = $1 LIMIT 1`, [hash]);
  return existing.rows[0] ? String(existing.rows[0].id) : null;
}

export async function checkHuntOnEbay(
  db: Queryable,
  huntIdOrSlug: string,
  opts: { fetch?: HuntBrowseFetch; now?: () => Date; delayMs?: number } = {},
): Promise<HuntEbayCheckResult | null> {
  const fetchBrowse = opts.fetch ?? ebayHuntBrowse;
  const now = opts.now ?? (() => new Date());
  const delayMs = opts.delayMs ?? 300;
  const hunt = await db.query(
    `SELECT id FROM vault_hunt.collection_hunt WHERE id::text = $1 OR slug = $1 LIMIT 1`,
    [huntIdOrSlug],
  );
  const huntId = hunt.rows[0]?.id as string | undefined;
  if (!huntId) return null;
  const items = await db.query(
    `SELECT i.id, i.status, i.buy_under, i.metadata
       FROM vault_hunt.hunt_item i
       JOIN vault_hunt.hunt_section s ON s.id = i.section_id
      WHERE s.hunt_id = $1
      ORDER BY i.sort_order, i.name`,
    [huntId],
  );

  const result: HuntEbayCheckResult = {
    huntId,
    checked: 0,
    skipped: [],
    listings: 0,
    strongListings: 0,
    newAlerts: 0,
    stoppedReason: null,
    errors: [],
  };
  for (const row of items.rows) {
    const itemId = String(row.id);
    if (row.status === "owned" || row.status === "pass") {
      result.skipped.push({ itemId, reason: `status ${row.status}` });
      continue;
    }
    const def = ((row.metadata ?? {}) as { definition?: Record<string, unknown> }).definition ?? {};
    const query = huntSearchQuery(def);
    if (!query) {
      result.skipped.push({ itemId, reason: "no series/issue to search for" });
      continue;
    }
    if (result.checked > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const browse = await fetchBrowse(query);
    if (!browse.ok) {
      result.errors.push({ itemId, error: browse.error });
      if (browse.fatal) {
        result.stoppedReason = browse.error;
        break;
      }
      continue;
    }
    result.checked += 1;
    const asks = asksFromBrowse(browse.rawJson, def);
    const observedAt = now();
    const snapshotId = await insertSnapshot(db, browse.rawJson, asks.length);
    const provenance = [HUNT_BROWSE_SOURCE, "inferred", HUNT_MARKET_RULE] as const;
    if (asks.length === 0) {
      await db.query(
        `INSERT INTO vault_hunt.hunt_listing_observation
           (hunt_item_id, observation_kind, source, query_text, title_match, observed_at, raw_snapshot_id,
            prov_source, prov_method, prov_rule_version, prov_confidence, prov_notes)
         VALUES ($1, 'browse_empty', $2, $3, 'none', $4, $5, $2, $6, $7, 0.5, 'Browse search ran and returned no USD asks')
         ON CONFLICT DO NOTHING`,
        [itemId, HUNT_BROWSE_SOURCE, query, observedAt, snapshotId, provenance[1], provenance[2]],
      );
      continue;
    }
    const bands = (def.priceBands as HuntPriceBand[] | undefined) ?? [];
    const target = row.buy_under == null ? null : Number(row.buy_under);
    for (const ask of asks) {
      result.listings += 1;
      if (ask.titleMatch === "strong") result.strongListings += 1;
      const inserted = await db.query(
        `INSERT INTO vault_hunt.hunt_listing_observation
           (hunt_item_id, observation_kind, source, query_text, listing_id, ask_price, listing_title, listing_url,
            condition_key, title_match, observed_at, raw_snapshot_id, provider_ids,
            prov_source, prov_method, prov_rule_version, prov_confidence, prov_notes)
         VALUES ($1, 'browse_listing', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $2, $13, $14, $15,
                 'eBay Browse ask · asking price is not market value')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          itemId, HUNT_BROWSE_SOURCE, query, ask.listingId, ask.askPrice, ask.title, ask.url,
          ask.conditionKey, ask.titleMatch, observedAt, snapshotId,
          JSON.stringify({ ebay_item_id: ask.listingId }),
          provenance[1], provenance[2], ask.titleMatch === "strong" ? 0.7 : ask.titleMatch === "weak" ? 0.4 : 0.2,
        ],
      );
      const observationId = inserted.rows[0]?.id as string | undefined;
      if (!observationId || !isAlertable(ask)) continue;
      const band = huntAlertBand({ priceBands: bands, targetPrice: target }, ask.askPrice);
      if (!band) continue;
      const alert = await db.query(
        `INSERT INTO vault_hunt.hunt_band_alert
           (hunt_item_id, source, listing_id, band, ask_price, listing_title, listing_url, observation_id, prov_rule_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (hunt_item_id, source, listing_id) DO NOTHING
         RETURNING id`,
        [itemId, HUNT_BROWSE_SOURCE, ask.listingId, band, ask.askPrice, ask.title, ask.url, observationId, HUNT_MARKET_RULE],
      );
      if (alert.rows[0]) result.newAlerts += 1;
    }
  }
  return result;
}

/** Latest check per item, computed from observations (never stored on the item). */
export async function loadHuntMarket(db: Queryable, itemIds: string[]): Promise<Map<string, HuntItemMarket>> {
  const out = new Map<string, HuntItemMarket>();
  if (itemIds.length === 0) return out;
  const latest = await db.query(
    `WITH last AS (
       SELECT hunt_item_id, max(observed_at) AS observed_at
         FROM vault_hunt.hunt_listing_observation
        WHERE hunt_item_id = ANY($1::uuid[])
        GROUP BY hunt_item_id
     )
     SELECT o.hunt_item_id, o.observed_at, o.observation_kind, o.ask_price, o.condition_key, o.title_match,
            o.listing_title
       FROM vault_hunt.hunt_listing_observation o
       JOIN last ON last.hunt_item_id = o.hunt_item_id AND last.observed_at = o.observed_at`,
    [itemIds],
  );
  const alerts = await db.query(
    `SELECT id, hunt_item_id, band, ask_price, listing_title, listing_url, status, created_at
       FROM vault_hunt.hunt_band_alert
      WHERE hunt_item_id = ANY($1::uuid[]) AND status <> 'dismissed'
      ORDER BY created_at DESC`,
    [itemIds],
  );
  const blank = (): HuntItemMarket => ({
    checkedAt: null,
    strongCount: 0,
    listingCount: 0,
    lowStrongAsk: null,
    alerts: [],
    ruleVersion: HUNT_MARKET_RULE,
    verification: "unverified",
  });
  for (const r of latest.rows) {
    const id = String(r.hunt_item_id);
    const m = out.get(id) ?? blank();
    m.checkedAt = new Date(String(r.observed_at)).toISOString();
    if (r.observation_kind === "browse_listing") {
      m.listingCount += 1;
      const ask = Number(r.ask_price);
      const exact = r.title_match === "strong" && r.condition_key !== "graded" && !isLotTitle(String(r.listing_title ?? ""));
      if (exact) {
        m.strongCount += 1;
        m.lowStrongAsk = m.lowStrongAsk == null ? ask : Math.min(m.lowStrongAsk, ask);
      }
    }
    out.set(id, m);
  }
  for (const a of alerts.rows) {
    const id = String(a.hunt_item_id);
    const m = out.get(id) ?? blank();
    m.alerts.push({
      id: String(a.id),
      band: a.band,
      askPrice: Number(a.ask_price),
      title: a.listing_title ?? null,
      url: a.listing_url ?? null,
      status: a.status,
      createdAt: new Date(String(a.created_at)).toISOString(),
    });
    out.set(id, m);
  }
  return out;
}

export async function setHuntAlertStatus(
  db: Queryable,
  huntIdOrSlug: string,
  alertId: string,
  status: "new" | "seen" | "dismissed",
): Promise<boolean> {
  const res = await db.query(
    `UPDATE vault_hunt.hunt_band_alert a
        SET status = $3
       FROM vault_hunt.hunt_item i
       JOIN vault_hunt.hunt_section s ON s.id = i.section_id
       JOIN vault_hunt.collection_hunt h ON h.id = s.hunt_id
      WHERE a.hunt_item_id = i.id AND a.id::text = $2 AND (h.id::text = $1 OR h.slug = $1)
      RETURNING a.id`,
    [huntIdOrSlug, alertId, status],
  );
  return res.rows.length > 0;
}
