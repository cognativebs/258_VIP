import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  DailyQueueItem,
  DispositionHistory,
  EbayAuditEvent,
  Experiment,
  ListingMetricSnapshot,
  LotProposal,
  MarketEvent,
  MarketObservation,
  MarketplaceListing,
  MarketplaceOrder,
  MarketplaceOrderLine,
  StoredUserToken,
} from "@vip/ebay-sell";
import { getDb } from "../../db/client.js";

export type StoredLot = LotProposal & {
  id: string;
  status: "proposed" | "accepted" | "listed" | "active" | "rejected" | "ended";
};

export type StoredQueueItem = DailyQueueItem & {
  id: string;
  queueDate: string;
  operatorAction?: DailyQueueItem extends never ? never : string | null;
  operatorNote?: string | null;
};

export type EbaySellStore = {
  getToken(): Promise<StoredUserToken | null>;
  saveToken(token: StoredUserToken): Promise<void>;
  clearToken(error?: string | null): Promise<void>;
  writeAudit(event: EbayAuditEvent): Promise<void>;
  listListings(): Promise<MarketplaceListing[]>;
  getListing(id: string): Promise<MarketplaceListing | null>;
  findListingBySku(sku: string): Promise<MarketplaceListing | null>;
  findListingByIdempotency(key: string): Promise<MarketplaceListing | null>;
  upsertListing(listing: MarketplaceListing): Promise<MarketplaceListing>;
  listOrders(): Promise<MarketplaceOrder[]>;
  listOrderLines(): Promise<MarketplaceOrderLine[]>;
  hasOrderLine(externalOrderId: string, externalLineItemId: string): Promise<boolean>;
  insertOrder(order: MarketplaceOrder, lines: MarketplaceOrderLine[]): Promise<void>;
  insertObservation(obs: MarketObservation): Promise<void>;
  listObservations(inventoryId?: string): Promise<MarketObservation[]>;
  insertDisposition(row: DispositionHistory): Promise<void>;
  listDisposition(inventoryId: string): Promise<DispositionHistory[]>;
  listLots(): Promise<StoredLot[]>;
  upsertLot(lot: StoredLot): Promise<StoredLot>;
  listQueue(date: string): Promise<StoredQueueItem[]>;
  replaceQueue(date: string, items: StoredQueueItem[]): Promise<void>;
  updateQueueItem(id: string, patch: Partial<StoredQueueItem>): Promise<StoredQueueItem | null>;
  listEvents(): Promise<MarketEvent[]>;
  upsertEvent(event: MarketEvent): Promise<void>;
  listExperiments(): Promise<Experiment[]>;
  listMetrics(): Promise<ListingMetricSnapshot[]>;
  insertMetrics(rows: ListingMetricSnapshot[]): Promise<void>;
};

export function createMemoryEbaySellStore(): EbaySellStore {
  let token: StoredUserToken | null = null;
  const listings = new Map<string, MarketplaceListing>();
  const orders = new Map<string, MarketplaceOrder>();
  const lines: MarketplaceOrderLine[] = [];
  const observations: MarketObservation[] = [];
  const dispositions: DispositionHistory[] = [];
  const lots = new Map<string, StoredLot>();
  let queue: StoredQueueItem[] = [];
  const events = new Map<string, MarketEvent>();
  const experiments: Experiment[] = [];
  const metrics: ListingMetricSnapshot[] = [];
  const audit: EbayAuditEvent[] = [];

  return {
    async getToken() {
      return token;
    },
    async saveToken(next) {
      token = next;
    },
    async clearToken() {
      token = null;
    },
    async writeAudit(event) {
      audit.push(event);
    },
    async listListings() {
      return [...listings.values()];
    },
    async getListing(id) {
      return listings.get(id) ?? null;
    },
    async findListingBySku(sku) {
      return [...listings.values()].find((l) => l.sku === sku) ?? null;
    },
    async findListingByIdempotency(key) {
      return [...listings.values()].find((l) => l.idempotencyKey === key) ?? null;
    },
    async upsertListing(listing) {
      listings.set(listing.id, listing);
      return listing;
    },
    async listOrders() {
      return [...orders.values()];
    },
    async listOrderLines() {
      return [...lines];
    },
    async hasOrderLine(externalOrderId, externalLineItemId) {
      const order = [...orders.values()].find((o) => o.externalOrderId === externalOrderId);
      if (!order) return false;
      return lines.some(
        (l) => l.marketplaceOrderId === order.id && l.externalLineItemId === externalLineItemId,
      );
    },
    async insertOrder(order, nextLines) {
      orders.set(order.id, order);
      lines.push(...nextLines);
    },
    async insertObservation(obs) {
      observations.push(obs);
    },
    async listObservations(inventoryId) {
      return inventoryId ? observations.filter((o) => o.inventoryId === inventoryId) : observations;
    },
    async insertDisposition(row) {
      dispositions.push(row);
    },
    async listDisposition(inventoryId) {
      return dispositions.filter((d) => d.inventoryId === inventoryId);
    },
    async listLots() {
      return [...lots.values()];
    },
    async upsertLot(lot) {
      lots.set(lot.id, lot);
      return lot;
    },
    async listQueue(date) {
      return queue.filter((q) => q.queueDate === date);
    },
    async replaceQueue(date, items) {
      queue = [...queue.filter((q) => q.queueDate !== date), ...items];
    },
    async updateQueueItem(id, patch) {
      const idx = queue.findIndex((q) => q.id === id);
      if (idx < 0) return null;
      const next = { ...queue[idx], ...patch } as StoredQueueItem;
      queue[idx] = next;
      return next;
    },
    async listEvents() {
      return [...events.values()];
    },
    async upsertEvent(event) {
      events.set(event.eventId, event);
    },
    async listExperiments() {
      return experiments;
    },
    async listMetrics() {
      return metrics;
    },
    async insertMetrics(rows) {
      metrics.push(...rows);
    },
  };
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function createPostgresEbaySellStore(): EbaySellStore {
  const db = () => getDb();
  return {
    async getToken() {
      const result = await db().execute(sql`
        SELECT refresh_token, access_token_expires_at, scopes
        FROM vault_collection.ebay_connection
        ORDER BY updated_at DESC
        LIMIT 1
      `);
      const row = (result.rows as Record<string, unknown>[])[0];
      if (!row?.refresh_token) return null;
      return {
        accessToken: "",
        refreshToken: String(row.refresh_token),
        expiresAt: row.access_token_expires_at
          ? new Date(String(row.access_token_expires_at))
          : new Date(0),
        scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
      };
    },
    async saveToken(token) {
      await db().execute(sql`
        INSERT INTO vault_collection.ebay_connection
          (environment, refresh_token, access_token_expires_at, scopes, connected_at, updated_at)
        VALUES (
          ${process.env.EBAY_ENV === "production" || process.env.EBAY_ENVIRONMENT === "production" ? "production" : "sandbox"},
          ${token.refreshToken},
          ${token.expiresAt.toISOString()}::timestamptz,
          ${token.scopes}::text[],
          now(),
          now()
        )
      `);
    },
    async clearToken(error) {
      await db().execute(sql`
        UPDATE vault_collection.ebay_connection
        SET refresh_token = NULL, disconnected_at = now(), last_error = ${error ?? null}, updated_at = now()
      `);
    },
    async writeAudit(event) {
      await db().execute(sql`
        INSERT INTO vault_collection.ebay_api_audit
          (method, path, status, error_class, error_message, idempotency_key, duration_ms)
        VALUES (
          ${event.method}, ${event.path}, ${event.status},
          ${event.errorClass}, ${event.errorMessage},
          ${event.requestIdempotencyKey ?? null}, ${event.durationMs}
        )
      `);
    },
    async listListings() {
      const result = await db().execute(sql`
        SELECT * FROM vault_collection.marketplace_listing ORDER BY created_at DESC LIMIT 500
      `);
      return (result.rows as Record<string, unknown>[]).map(rowToListing);
    },
    async getListing(id) {
      const result = await db().execute(sql`
        SELECT * FROM vault_collection.marketplace_listing WHERE id = ${id}::uuid
      `);
      const row = (result.rows as Record<string, unknown>[])[0];
      return row ? rowToListing(row) : null;
    },
    async findListingBySku(sku) {
      const result = await db().execute(sql`
        SELECT * FROM vault_collection.marketplace_listing
        WHERE sku = ${sku}
        ORDER BY created_at DESC LIMIT 1
      `);
      const row = (result.rows as Record<string, unknown>[])[0];
      return row ? rowToListing(row) : null;
    },
    async findListingByIdempotency(key) {
      const result = await db().execute(sql`
        SELECT * FROM vault_collection.marketplace_listing WHERE idempotency_key = ${key}
      `);
      const row = (result.rows as Record<string, unknown>[])[0];
      return row ? rowToListing(row) : null;
    },
    async upsertListing(listing) {
      await db().execute(sql`
        INSERT INTO vault_collection.marketplace_listing (
          id, inventory_id, holding_id, marketplace, sku, listing_kind,
          external_offer_id, external_listing_id, listing_format, status, title, category_id,
          price, minimum_offer_price, quantity, currency,
          payment_policy_id, return_policy_id, fulfillment_policy_id, merchant_location_key,
          promoted, pricing_strategy, fmv_low, fmv_high, fmv_mid, fmv_confidence, fmv_evidence_count,
          fmv_source, listed_at, ended_at, last_synced_at, error_class, error_message,
          listing_payload, idempotency_key,
          prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
        ) VALUES (
          ${listing.id}::uuid, ${listing.inventoryId},
          ${listing.holdingUuid ?? null},
          'ebay', ${listing.sku}, ${listing.listingKind},
          ${listing.externalOfferId}, ${listing.externalListingId},
          ${listing.listingFormat}, ${listing.status}, ${listing.title}, ${listing.categoryId},
          ${listing.price}, ${listing.minimumOfferPrice}, ${listing.quantity}, ${listing.currency},
          ${listing.paymentPolicyId}, ${listing.returnPolicyId}, ${listing.fulfillmentPolicyId},
          ${listing.merchantLocationKey}, ${listing.promoted}, ${listing.pricingStrategy ?? null},
          ${listing.fmvAtListing?.low ?? null}, ${listing.fmvAtListing?.high ?? null},
          ${listing.fmvAtListing?.mid ?? null}, ${listing.fmvAtListing?.confidence ?? null},
          ${listing.fmvAtListing?.evidenceCount ?? null}, ${listing.fmvAtListing?.source ?? null},
          ${listing.listedAt ? listing.listedAt.toISOString() : null},
          ${listing.endedAt ? listing.endedAt.toISOString() : null},
          ${listing.lastSyncedAt ? listing.lastSyncedAt.toISOString() : null},
          ${listing.errorClass ?? null}, ${listing.errorMessage ?? null},
          ${JSON.stringify({})}::jsonb, ${listing.idempotencyKey},
          ${listing.provenance.source}, ${listing.provenance.method}::vault_evidence.provenance_method,
          ${listing.provenance.ruleOrModelVersion}, ${listing.provenance.confidence},
          ${listing.provenance.verificationStatus}::vault_evidence.verification_status,
          ${listing.provenance.notes ?? null}
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          external_offer_id = EXCLUDED.external_offer_id,
          external_listing_id = EXCLUDED.external_listing_id,
          price = EXCLUDED.price,
          listed_at = EXCLUDED.listed_at,
          ended_at = EXCLUDED.ended_at,
          last_synced_at = EXCLUDED.last_synced_at,
          error_class = EXCLUDED.error_class,
          error_message = EXCLUDED.error_message,
          updated_at = now()
      `);
      return listing;
    },
    async listOrders() {
      const result = await db().execute(sql`
        SELECT * FROM vault_market.marketplace_order ORDER BY order_created_at DESC LIMIT 200
      `);
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        marketplace: "ebay" as const,
        externalOrderId: String(row.external_order_id),
        orderCreatedAt: new Date(String(row.order_created_at)),
        orderStatus: String(row.order_status),
        buyerReference: row.buyer_reference == null ? null : String(row.buyer_reference),
        grossTotal: Number(row.gross_total ?? 0),
        shippingCollected: num(row.shipping_collected),
        taxAmount: num(row.tax_amount),
        currency: String(row.currency ?? "USD"),
        fulfillmentStatus: row.fulfillment_status == null ? null : String(row.fulfillment_status),
        shippedAt: row.shipped_at ? new Date(String(row.shipped_at)) : null,
        deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)) : null,
        lastSyncedAt: row.last_synced_at ? new Date(String(row.last_synced_at)) : null,
      }));
    },
    async listOrderLines() {
      const result = await db().execute(sql`
        SELECT * FROM vault_market.marketplace_order_line
      `);
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        marketplaceOrderId: String(row.marketplace_order_id),
        inventoryId: row.inventory_id == null ? null : String(row.inventory_id),
        sku: String(row.sku),
        externalLineItemId: String(row.external_line_item_id),
        quantity: Number(row.quantity ?? 1),
        salePrice: Number(row.sale_price),
        shippingAllocated: num(row.shipping_allocated),
        feeAllocated: num(row.fee_allocated),
        promotionFeeAllocated: num(row.promotion_fee_allocated),
        netProceeds: num(row.net_proceeds),
        feeIsEstimate: row.fee_is_estimate !== false,
      }));
    },
    async hasOrderLine(externalOrderId, externalLineItemId) {
      const result = await db().execute(sql`
        SELECT 1
        FROM vault_market.marketplace_order_line l
        JOIN vault_market.marketplace_order o ON o.id = l.marketplace_order_id
        WHERE o.external_order_id = ${externalOrderId}
          AND l.external_line_item_id = ${externalLineItemId}
        LIMIT 1
      `);
      return (result.rows as unknown[]).length > 0;
    },
    async insertOrder(order, nextLines) {
      await db().execute(sql`
        INSERT INTO vault_market.marketplace_order (
          id, marketplace, external_order_id, order_created_at, order_status, buyer_reference,
          gross_total, shipping_collected, tax_amount, currency, fulfillment_status, last_synced_at
        ) VALUES (
          ${order.id}::uuid, 'ebay', ${order.externalOrderId},
          ${order.orderCreatedAt.toISOString()}::timestamptz, ${order.orderStatus},
          ${order.buyerReference}, ${order.grossTotal}, ${order.shippingCollected},
          ${order.taxAmount}, ${order.currency}, ${order.fulfillmentStatus}, now()
        )
        ON CONFLICT (marketplace, external_order_id) DO NOTHING
      `);
      for (const line of nextLines) {
        await db().execute(sql`
          INSERT INTO vault_market.marketplace_order_line (
            id, marketplace_order_id, inventory_id, sku, external_line_item_id, quantity,
            sale_price, shipping_allocated, fee_allocated, net_proceeds, fee_is_estimate
          ) VALUES (
            ${line.id}::uuid, ${line.marketplaceOrderId}::uuid, ${line.inventoryId},
            ${line.sku}, ${line.externalLineItemId}, ${line.quantity},
            ${line.salePrice}, ${line.shippingAllocated}, ${line.feeAllocated},
            ${line.netProceeds}, ${line.feeIsEstimate}
          )
          ON CONFLICT (marketplace_order_id, external_line_item_id) DO NOTHING
        `);
      }
    },
    async insertObservation(obs) {
      await db().execute(sql`
        INSERT INTO vault_market.market_observation (
          id, inventory_id, observation_type, observed_at, value, currency, source,
          marketplace_listing_id, confidence, metadata_json,
          prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
        ) VALUES (
          ${obs.id}::uuid, ${obs.inventoryId}, ${obs.observationType},
          ${obs.observedAt.toISOString()}::timestamptz, ${obs.value}, ${obs.currency},
          ${obs.source}, ${obs.marketplaceListingId}, ${obs.confidence},
          ${JSON.stringify(obs.metadata)}::jsonb,
          ${obs.provenance.source}, ${obs.provenance.method}::vault_evidence.provenance_method,
          ${obs.provenance.ruleOrModelVersion}, ${obs.provenance.confidence},
          ${obs.provenance.verificationStatus}::vault_evidence.verification_status,
          ${obs.provenance.notes ?? null}
        )
      `);
    },
    async listObservations(inventoryId) {
      const result = inventoryId
        ? await db().execute(sql`
            SELECT * FROM vault_market.market_observation
            WHERE inventory_id = ${inventoryId} ORDER BY observed_at DESC
          `)
        : await db().execute(sql`
            SELECT * FROM vault_market.market_observation ORDER BY observed_at DESC LIMIT 200
          `);
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        inventoryId: String(row.inventory_id),
        observationType: row.observation_type as MarketObservation["observationType"],
        observedAt: new Date(String(row.observed_at)),
        value: Number(row.value),
        currency: String(row.currency ?? "USD"),
        source: String(row.source),
        marketplaceListingId: row.marketplace_listing_id ? String(row.marketplace_listing_id) : null,
        confidence: Number(row.confidence),
        metadata: (row.metadata_json as Record<string, unknown>) ?? {},
        provenance: {
          source: String(row.prov_source),
          method: row.prov_method as MarketObservation["provenance"]["method"],
          ruleOrModelVersion: String(row.prov_rule_version),
          confidence: Number(row.prov_confidence),
          verificationStatus: row.prov_verification as MarketObservation["provenance"]["verificationStatus"],
          notes: row.prov_notes == null ? undefined : String(row.prov_notes),
        },
      }));
    },
    async insertDisposition(row) {
      await db().execute(sql`
        INSERT INTO vault_collection.disposition_history (
          id, inventory_id, previous_disposition, new_disposition, reason_code, reason_text,
          confidence, recommended_by
        ) VALUES (
          ${row.id}::uuid, ${row.inventoryId}, ${row.previousDisposition},
          ${row.newDisposition}, ${row.reasonCode}, ${row.reasonText},
          ${row.confidence}, ${row.recommendedBy}
        )
      `);
      await db().execute(sql`
        UPDATE vault_collection.holding
        SET current_disposition = ${row.newDisposition}, updated_at = now()
        WHERE source_row_id = ${row.inventoryId} OR id::text = ${row.inventoryId}
      `);
    },
    async listDisposition(inventoryId) {
      const result = await db().execute(sql`
        SELECT * FROM vault_collection.disposition_history
        WHERE inventory_id = ${inventoryId} ORDER BY created_at DESC
      `);
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        inventoryId: String(row.inventory_id),
        previousDisposition: row.previous_disposition
          ? (String(row.previous_disposition) as DispositionHistory["previousDisposition"])
          : null,
        newDisposition: String(row.new_disposition) as DispositionHistory["newDisposition"],
        reasonCode: String(row.reason_code),
        reasonText: String(row.reason_text),
        confidence: Number(row.confidence),
        recommendedBy: String(row.recommended_by) as DispositionHistory["recommendedBy"],
        createdAt: new Date(String(row.created_at)),
      }));
    },
    async listLots() {
      const lots = await db().execute(sql`SELECT * FROM vault_collection.listing_lot ORDER BY created_at DESC`);
      const members = await db().execute(sql`SELECT * FROM vault_collection.listing_lot_member`);
      const byLot = new Map<string, string[]>();
      for (const row of members.rows as Record<string, unknown>[]) {
        const id = String(row.lot_id);
        byLot.set(id, [...(byLot.get(id) ?? []), String(row.inventory_id)]);
      }
      return (lots.rows as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        status: String(row.status) as StoredLot["status"],
        lotName: String(row.lot_name),
        groupingKey: String(row.grouping_key),
        inventoryIds: byLot.get(String(row.id)) ?? [],
        combinedFmv: Number(row.combined_fmv ?? 0),
        recommendedPrice: Number(row.recommended_price ?? 0),
        estimatedNet: Number(row.estimated_net ?? 0),
        estimatedLaborMinutes: Number(row.estimated_labor_minutes ?? 0),
        netDollarsPerLaborMinute: Number(row.net_per_labor_minute ?? 0),
        confidence: Number(row.confidence ?? 0),
        lotScore: Number(row.lot_score ?? 0),
        currency: "USD",
        reasonCodes: [],
        provenance: {
          source: "lot_builder",
          method: "inferred" as const,
          ruleOrModelVersion: "ebay-lot-builder@0.1.0",
          confidence: Number(row.confidence ?? 0),
          verificationStatus: "unverified" as const,
        },
      }));
    },
    async upsertLot(lot) {
      await db().execute(sql`
        INSERT INTO vault_collection.listing_lot (
          id, lot_name, grouping_key, status, combined_fmv, recommended_price, estimated_net,
          estimated_labor_minutes, net_per_labor_minute, lot_score, confidence
        ) VALUES (
          ${lot.id}::uuid, ${lot.lotName}, ${lot.groupingKey}, ${lot.status},
          ${lot.combinedFmv}, ${lot.recommendedPrice}, ${lot.estimatedNet},
          ${lot.estimatedLaborMinutes}, ${lot.netDollarsPerLaborMinute}, ${lot.lotScore},
          ${lot.confidence}
        )
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()
      `);
      for (const inventoryId of lot.inventoryIds) {
        await db().execute(sql`
          INSERT INTO vault_collection.listing_lot_member (lot_id, inventory_id, lot_status)
          VALUES (${lot.id}::uuid, ${inventoryId}, ${lot.status})
          ON CONFLICT (lot_id, inventory_id) DO UPDATE SET lot_status = EXCLUDED.lot_status
        `);
      }
      return lot;
    },
    async listQueue(date) {
      const result = await db().execute(sql`
        SELECT * FROM vault_collection.listing_queue_item
        WHERE queue_date = ${date}::date
        ORDER BY priority_score DESC
      `);
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        queueDate: date,
        inventoryId: String(row.inventory_id ?? ""),
        lotId: row.lot_id ? String(row.lot_id) : undefined,
        priorityScore: Number(row.priority_score),
        bucket: String(row.bucket) as StoredQueueItem["bucket"],
        recommendedFormat: "FIXED_PRICE" as const,
        recommendedPrice: num(row.recommended_price),
        minimumPrice: num(row.minimum_price),
        pricingStrategy: String(row.pricing_strategy ?? "NORMAL") as StoredQueueItem["pricingStrategy"],
        estimatedNet: num(row.estimated_net),
        estimatedLaborMinutes: Number(row.estimated_labor_minutes ?? 0),
        reason: String(row.reason),
        confidence: Number(row.confidence),
        disposition: String(row.disposition) as StoredQueueItem["disposition"],
        operatorAction: row.operator_action == null ? null : String(row.operator_action),
        operatorNote: row.operator_note == null ? null : String(row.operator_note),
      }));
    },
    async replaceQueue(date, items) {
      await db().execute(sql`
        DELETE FROM vault_collection.listing_queue_item WHERE queue_date = ${date}::date
      `);
      for (const item of items) {
        await db().execute(sql`
          INSERT INTO vault_collection.listing_queue_item (
            id, queue_date, inventory_id, lot_id, priority_score, bucket, recommended_format,
            recommended_price, minimum_price, pricing_strategy, estimated_net,
            estimated_labor_minutes, reason, confidence, disposition
          ) VALUES (
            ${item.id}::uuid, ${date}::date, ${item.inventoryId}, ${item.lotId ?? null},
            ${item.priorityScore}, ${item.bucket}, ${item.recommendedFormat},
            ${item.recommendedPrice}, ${item.minimumPrice}, ${item.pricingStrategy},
            ${item.estimatedNet}, ${item.estimatedLaborMinutes}, ${item.reason},
            ${item.confidence}, ${item.disposition}
          )
        `);
      }
    },
    async updateQueueItem(id, patch) {
      await db().execute(sql`
        UPDATE vault_collection.listing_queue_item
        SET operator_action = ${patch.operatorAction ?? null},
            operator_note = ${patch.operatorNote ?? null},
            updated_at = now()
        WHERE id = ${id}::uuid
      `);
      const rows = await db().execute(sql`
        SELECT queue_date FROM vault_collection.listing_queue_item WHERE id = ${id}::uuid
      `);
      const date = String((rows.rows as Record<string, unknown>[])[0]?.queue_date ?? "");
      return (await this.listQueue(date)).find((q) => q.id === id) ?? null;
    },
    async listEvents() {
      const result = await db().execute(sql`SELECT * FROM vault_collection.market_event`);
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        eventId: String(row.event_id),
        subjectType: String(row.subject_type),
        subjectId: String(row.subject_id),
        eventType: String(row.event_type),
        eventTime: new Date(String(row.event_time)),
        severity: Number(row.severity),
        confidence: Number(row.confidence),
        source: String(row.source),
        summary: String(row.summary),
        expiresAt: row.expires_at ? new Date(String(row.expires_at)) : null,
      }));
    },
    async upsertEvent(event) {
      await db().execute(sql`
        INSERT INTO vault_collection.market_event (
          event_id, subject_type, subject_id, event_type, event_time, severity, confidence, source, summary, expires_at
        ) VALUES (
          ${event.eventId}, ${event.subjectType}, ${event.subjectId}, ${event.eventType},
          ${event.eventTime.toISOString()}::timestamptz, ${event.severity}, ${event.confidence},
          ${event.source}, ${event.summary},
          ${event.expiresAt ? event.expiresAt.toISOString() : null}
        )
        ON CONFLICT (event_id) DO UPDATE SET summary = EXCLUDED.summary, severity = EXCLUDED.severity
      `);
    },
    async listExperiments() {
      const result = await db().execute(sql`SELECT * FROM vault_collection.selling_experiment`);
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        experimentId: String(row.experiment_id),
        name: String(row.name),
        startDate: new Date(String(row.start_date)),
        endDate: row.end_date ? new Date(String(row.end_date)) : null,
        hypothesis: String(row.hypothesis),
        cohortDefinition: (row.cohort_definition as Record<string, unknown>) ?? {},
        strategy: String(row.strategy),
        status: String(row.status) as Experiment["status"],
      }));
    },
    async listMetrics() {
      const result = await db().execute(sql`
        SELECT * FROM vault_market.listing_metric_snapshot ORDER BY captured_at DESC LIMIT 500
      `);
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        marketplaceListingId: String(row.marketplace_listing_id),
        capturedAt: new Date(String(row.captured_at)),
        impressionsSearch: num(row.impressions_search),
        impressionsStore: num(row.impressions_store),
        impressionsTotal: num(row.impressions_total),
        viewsTotal: num(row.views_total),
        viewsSearch: num(row.views_search),
        viewsStore: num(row.views_store),
        viewsDirect: num(row.views_direct),
        viewsOffEbay: num(row.views_off_ebay),
        watcherCount: num(row.watcher_count),
        offerCount: num(row.offer_count),
        dataSource: String(row.data_source),
      }));
    },
    async insertMetrics(rows) {
      for (const row of rows) {
        await db().execute(sql`
          INSERT INTO vault_market.listing_metric_snapshot (
            id, marketplace_listing_id, captured_at, impressions_total, views_total,
            watcher_count, offer_count, data_source
          ) VALUES (
            ${row.id}::uuid, ${row.marketplaceListingId}::uuid, ${row.capturedAt.toISOString()}::timestamptz,
            ${row.impressionsTotal}, ${row.viewsTotal}, ${row.watcherCount}, ${row.offerCount},
            ${row.dataSource}
          )
        `);
      }
    },
  };
}

function rowToListing(row: Record<string, unknown>): MarketplaceListing {
  const fmvMid = num(row.fmv_mid);
  return {
    id: String(row.id),
    inventoryId: String(row.inventory_id),
    holdingUuid: row.holding_id ? String(row.holding_id) : null,
    marketplace: "ebay",
    sku: String(row.sku),
    listingKind: (row.listing_kind as MarketplaceListing["listingKind"]) ?? "single",
    externalOfferId: row.external_offer_id == null ? null : String(row.external_offer_id),
    externalListingId: row.external_listing_id == null ? null : String(row.external_listing_id),
    listingFormat: (row.listing_format as MarketplaceListing["listingFormat"]) ?? "FIXED_PRICE",
    status: row.status as MarketplaceListing["status"],
    title: String(row.title),
    categoryId: row.category_id == null ? null : String(row.category_id),
    price: num(row.price),
    minimumOfferPrice: num(row.minimum_offer_price),
    quantity: Number(row.quantity ?? 1),
    currency: String(row.currency ?? "USD"),
    paymentPolicyId: row.payment_policy_id == null ? null : String(row.payment_policy_id),
    returnPolicyId: row.return_policy_id == null ? null : String(row.return_policy_id),
    fulfillmentPolicyId: row.fulfillment_policy_id == null ? null : String(row.fulfillment_policy_id),
    merchantLocationKey: row.merchant_location_key == null ? null : String(row.merchant_location_key),
    promoted: row.promoted === true,
    pricingStrategy: row.pricing_strategy
      ? (String(row.pricing_strategy) as MarketplaceListing["pricingStrategy"])
      : null,
    fmvAtListing:
      fmvMid == null
        ? null
        : {
            low: num(row.fmv_low) ?? fmvMid,
            high: num(row.fmv_high) ?? fmvMid,
            mid: fmvMid,
            currency: "USD",
            confidence: num(row.fmv_confidence) ?? 0,
            evidenceCount: Number(row.fmv_evidence_count ?? 0),
            source: String(row.fmv_source ?? "unknown"),
            method: "inferred",
            verificationStatus: "unverified",
            recencyDays: null,
          },
    listedAt: row.listed_at ? new Date(String(row.listed_at)) : null,
    endedAt: row.ended_at ? new Date(String(row.ended_at)) : null,
    lastSyncedAt: row.last_synced_at ? new Date(String(row.last_synced_at)) : null,
    errorClass: row.error_class ? (String(row.error_class) as MarketplaceListing["errorClass"]) : null,
    errorMessage: row.error_message == null ? null : String(row.error_message),
    idempotencyKey: String(row.idempotency_key),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
    provenance: {
      source: String(row.prov_source ?? "ebay_sell"),
      method: (row.prov_method as MarketplaceListing["provenance"]["method"]) ?? "inferred",
      ruleOrModelVersion: String(row.prov_rule_version ?? "ebay-sell@0.1.0"),
      confidence: Number(row.prov_confidence ?? 0.4),
      verificationStatus:
        (row.prov_verification as MarketplaceListing["provenance"]["verificationStatus"]) ??
        "unverified",
      notes: row.prov_notes == null ? undefined : String(row.prov_notes),
    },
  };
}

export function newId(): string {
  return randomUUID();
}
