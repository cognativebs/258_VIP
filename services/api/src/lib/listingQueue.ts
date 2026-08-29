import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  LISTING_QUEUE_RULE,
  ListingDraftSchema,
  QueueListingDraftsBodySchema,
  bucketSellPolicy,
  classifyInventoryBucket,
  type InventoryBucket,
  type ListingDraft,
  type QueueListingDraftsBody,
} from "@vip/core-model";
import { markInferred } from "@vip/evidence";
import { getDb } from "../db/client.js";
import type { ApiHolding } from "./holdings.js";
import { loadLiveRangeMap } from "./liveRange.js";

const MIN_LISTINGS_FOR_INVESTMENT = 3;

export function decideListingDraft(input: {
  holding: ApiHolding;
  body: QueueListingDraftsBody;
  listingCount: number;
  liveLow: number | null;
  liveHigh: number | null;
  hasEbayCreds: boolean;
}): Omit<ListingDraft, "id" | "createdAt" | "updatedAt" | "provenance"> & {
  provenance: ReturnType<typeof markInferred>;
} {
  const bucket = (input.holding.inventoryBucket ??
    classifyInventoryBucket({
      pillar: input.holding.pillar,
      recommendation: input.holding.recommendationLabel,
    }).bucket) as InventoryBucket;
  const policy = bucketSellPolicy(bucket);
  const title = input.holding.assetName.slice(0, 80) || "Untitled holding";
  const ask = input.body.askPrice ?? null;

  if (input.body.action !== "Sell") {
    return base(input, bucket, title, ask, {
      status: "blocked_not_sell",
      emptyReason: "Listing requires action Sell — scan confirm is Hold, not a list.",
    });
  }

  if (bucket === "personal_collection" && !input.body.personalOverrideNote) {
    return base(input, bucket, title, ask, {
      status: "blocked_personal",
      emptyReason: policy.notes,
    });
  }

  if (policy.sellWhenIntelligenceJustifies) {
    const inRange =
      ask != null &&
      input.liveLow != null &&
      input.liveHigh != null &&
      ask >= input.liveLow &&
      ask <= input.liveHigh;
    const enoughListings = input.listingCount >= MIN_LISTINGS_FOR_INVESTMENT;
    if (!enoughListings && !input.body.rangeOverrideNote) {
      return base(input, bucket, title, ask, {
        status: "blocked_insufficient_range",
        emptyReason: `Need ${MIN_LISTINGS_FOR_INVESTMENT}+ Browse listings (have ${input.listingCount}) or a range override note. LIVE is unverified asks, not sold.`,
      });
    }
    if (ask != null && !inRange && !input.body.rangeOverrideNote) {
      return base(input, bucket, title, ask, {
        status: "blocked_insufficient_range",
        emptyReason: `Ask ${ask} is outside live range ${input.liveLow}–${input.liveHigh}. Set rangeOverrideNote to proceed.`,
      });
    }
  }

  if (!input.hasEbayCreds) {
    return base(input, bucket, title, ask, {
      status: "pending_credentials",
      emptyReason:
        "eBay developer tokens not configured — draft held idle (set EBAY_OAUTH_TOKEN or client credentials)",
    });
  }

  return base(input, bucket, title, ask, {
    status: "draft_ready",
    emptyReason: null,
  });
}

function base(
  input: {
    holding: ApiHolding;
    body: QueueListingDraftsBody;
    listingCount: number;
    liveLow: number | null;
    liveHigh: number | null;
  },
  bucket: InventoryBucket,
  title: string,
  ask: number | null,
  status: { status: ListingDraft["status"]; emptyReason: string | null },
) {
  return {
    holdingId: null as string | null,
    holdingSourceRowId: input.holding.id,
    inventoryBucket: bucket,
    title,
    status: status.status,
    askPrice: ask,
    liveLow: input.liveLow,
    liveHigh: input.liveHigh,
    listingCount: input.listingCount,
    emptyReason: status.emptyReason,
    listingPayload: {
      title,
      submitReady: false,
      categoryHint: "comics",
      format: "FixedPrice",
    },
    overrideNote: input.body.personalOverrideNote ?? input.body.rangeOverrideNote ?? null,
    provenance: markInferred({
      source: "listing_queue",
      ruleOrModelVersion: LISTING_QUEUE_RULE,
      confidence: status.status === "draft_ready" ? 0.6 : 0.3,
      notes: status.emptyReason ?? "Draft ready · submitReady false until human Submit",
    }),
  };
}

export async function queueListingDrafts(
  holdings: ApiHolding[],
  rawBody: unknown,
  hasEbayCreds: boolean,
): Promise<{ drafts: ListingDraft[]; rejected: string | null }> {
  const parsed = QueueListingDraftsBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      drafts: [],
      rejected: parsed.error.issues.map((i) => i.message).join("; ") || "Invalid body",
    };
  }
  const byId = new Map(holdings.map((h) => [h.id, h]));
  const wanted = parsed.data.holdingSourceRowIds
    .map((id) => byId.get(id))
    .filter((h): h is ApiHolding => Boolean(h));
  const ranges = await loadLiveRangeMap(wanted.map((h) => h.id));
  const now = new Date();
  const drafts: ListingDraft[] = wanted.map((holding) => {
    const chip = ranges.get(holding.id);
    const decided = decideListingDraft({
      holding,
      body: parsed.data,
      listingCount: chip?.listingCount ?? 0,
      liveLow: chip?.low ?? null,
      liveHigh: chip?.high ?? null,
      hasEbayCreds,
    });
    return ListingDraftSchema.parse({
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...decided,
    });
  });

  await persistDrafts(drafts);
  return { drafts, rejected: null };
}

async function persistDrafts(drafts: ListingDraft[]): Promise<void> {
  if (drafts.length === 0) return;
  const db = getDb();
  for (const d of drafts) {
    await db.execute(sql`
      INSERT INTO vault_collection.listing_draft
        (id, holding_id, holding_source_row_id, inventory_bucket, title, status,
         ask_price, live_low, live_high, listing_count, empty_reason, listing_payload,
         override_note, prov_source, prov_method, prov_rule_version, prov_confidence,
         prov_verification, prov_notes)
      VALUES (
        ${d.id}::uuid,
        ${d.holdingId ? sql`${d.holdingId}::uuid` : sql`NULL`},
        ${d.holdingSourceRowId},
        ${d.inventoryBucket},
        ${d.title},
        ${d.status},
        ${d.askPrice},
        ${d.liveLow},
        ${d.liveHigh},
        ${d.listingCount},
        ${d.emptyReason ?? null},
        ${JSON.stringify(d.listingPayload)}::jsonb,
        ${d.overrideNote ?? null},
        ${d.provenance.source},
        ${d.provenance.method}::vault_evidence.provenance_method,
        ${d.provenance.ruleOrModelVersion},
        ${d.provenance.confidence},
        ${d.provenance.verificationStatus}::vault_evidence.verification_status,
        ${d.provenance.notes ?? null}
      )
    `);
  }
}

export async function listListingDrafts(): Promise<ListingDraft[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT *
    FROM vault_collection.listing_draft
    ORDER BY created_at DESC
    LIMIT 200
  `);
  return (result.rows as Record<string, unknown>[]).map((row) =>
    ListingDraftSchema.parse({
      id: String(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      holdingId: row.holding_id ? String(row.holding_id) : null,
      holdingSourceRowId: String(row.holding_source_row_id),
      inventoryBucket: row.inventory_bucket,
      title: String(row.title),
      status: row.status,
      askPrice: row.ask_price == null ? null : Number(row.ask_price),
      liveLow: row.live_low == null ? null : Number(row.live_low),
      liveHigh: row.live_high == null ? null : Number(row.live_high),
      listingCount: Number(row.listing_count ?? 0),
      emptyReason: row.empty_reason == null ? null : String(row.empty_reason),
      listingPayload: row.listing_payload ?? {},
      overrideNote: row.override_note == null ? null : String(row.override_note),
      provenance: {
        source: String(row.prov_source),
        method: String(row.prov_method),
        ruleOrModelVersion: String(row.prov_rule_version),
        confidence: Number(row.prov_confidence),
        verificationStatus: String(row.prov_verification),
        notes: row.prov_notes == null ? undefined : String(row.prov_notes),
      },
    }),
  );
}
