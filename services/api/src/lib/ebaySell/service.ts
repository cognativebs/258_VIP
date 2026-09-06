import { randomUUID } from "node:crypto";
import { markInferred } from "@vip/evidence";
import {
  ACTIVE_LISTING_STATUSES,
  DEFAULT_HIGH_VALUE_USD,
  EBAY_SELL_RULE,
  LOW_DOLLAR_EXPERIMENT,
  assertListingExclusivity,
  buildAuthorizationUrl,
  buildDailyListingQueue,
  buildEbaySku,
  buildListingDraftPayload,
  completeSale,
  computeEbayKpis,
  createAnalyticsAdapter,
  createEbayHttpClient,
  createFulfillmentAdapter,
  createInventoryAdapter,
  ebaySellAuthFromEnv,
  evaluateExperiment,
  exchangeAuthorizationCode,
  highValueRequiresApproval,
  listingIdFromOffer,
  listingStatusFromOffer,
  normalizeEbayOrders,
  normalizeTrafficRecords,
  orderLineKey,
  policiesFromConfig,
  proposeLots,
  recommendDisposition,
  sellAuthStatus,
  type BusinessPolicies,
  type DailyQueueItem,
  type EbaySellAuthConfig,
  type ListingDraftPayload,
  type MarketplaceListing,
  type SaleCompletionResult,
  type SellingDisposition,
  type StoredUserToken,
} from "@vip/ebay-sell";
import type { ApiHolding } from "../holdings.js";
import { applyHoldingPatch, holdingToSellingAsset, type HoldingSellPatch } from "./project.js";
import type { EbaySellStore, StoredLot, StoredQueueItem } from "./store.js";

export type EbaySellDeps = {
  store: EbaySellStore;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  highValueUsd?: number;
  autoPublishHighValue?: boolean;
};

export function createEbaySellService(deps: EbaySellDeps) {
  const now = deps.now ?? (() => new Date());
  const highValueUsd = deps.highValueUsd ?? Number(process.env.EBAY_HIGH_VALUE_USD ?? DEFAULT_HIGH_VALUE_USD);
  const autoPublishHighValue =
    deps.autoPublishHighValue ?? process.env.EBAY_AUTO_PUBLISH_HIGH_VALUE === "true";

  function config(): EbaySellAuthConfig | null {
    return ebaySellAuthFromEnv();
  }

  async function connection() {
    const token = await deps.store.getToken();
    const status = sellAuthStatus({ config: config(), token });
    const blockers: string[] = [];
    if (!status.configured) blockers.push("APP_CREDENTIALS");
    if (!status.connected) blockers.push("USER_OAUTH");
    if (!status.policiesConfigured) blockers.push("BUSINESS_POLICIES");
    return {
      status,
      canPublish: blockers.length === 0,
      blockers,
    };
  }

  async function startAuth(state: string) {
    const cfg = config();
    if (!cfg) {
      return { error: "eBay Sell OAuth idle — set EBAY_APP_ID, EBAY_CERT_ID, EBAY_REDIRECT_URI" };
    }
    return { url: buildAuthorizationUrl(cfg, state), state };
  }

  async function handleCallback(code: string) {
    const cfg = config();
    if (!cfg) throw new Error("eBay Sell OAuth is not configured");
    const token = await exchangeAuthorizationCode(cfg, code, deps.fetchImpl);
    await deps.store.saveToken(token);
    return sellAuthStatus({ config: cfg, token });
  }

  async function disconnect() {
    await deps.store.clearToken("disconnected by operator");
    return connection();
  }

  async function persistHolding(holding: ApiHolding, patch: HoldingSellPatch) {
    await deps.store.patchHolding(holding.id, patch);
    if (holding.holdingUuid && holding.holdingUuid !== holding.id) {
      await deps.store.patchHolding(holding.holdingUuid, patch);
    }
  }

  async function hydrateHolding(holding: ApiHolding): Promise<ApiHolding> {
    const byId = await deps.store.getHoldingPatch(holding.id);
    const byUuid =
      holding.holdingUuid && holding.holdingUuid !== holding.id
        ? await deps.store.getHoldingPatch(holding.holdingUuid)
        : null;
    return applyHoldingPatch(applyHoldingPatch(holding, byUuid), byId);
  }

  async function hydrateHoldings(holdings: ApiHolding[]): Promise<ApiHolding[]> {
    return Promise.all(holdings.map((h) => hydrateHolding(h)));
  }

  function ensureSku(holding: ApiHolding): string {
    if (holding.ebaySku) return holding.ebaySku;
    const category = holdingToSellingAsset(holding).category;
    return buildEbaySku(category, holding.holdingUuid ?? holding.id);
  }

  async function recommendFor(holding: ApiHolding, override?: { disposition: SellingDisposition; reasonText: string }) {
    const asset = holdingToSellingAsset(holding);
    const rec = recommendDisposition(asset, override);
    await deps.store.insertDisposition({
      id: randomUUID(),
      inventoryId: holding.id,
      previousDisposition: holding.currentDisposition ?? null,
      newDisposition: rec.disposition,
      reasonCode: rec.reasonCodes[0] ?? "RULE",
      reasonText: rec.reasonText,
      confidence: rec.confidence,
      recommendedBy: rec.recommendedBy,
      createdAt: now(),
    });
    return rec;
  }

  async function draftFromHolding(holding: ApiHolding): Promise<{
    listing: MarketplaceListing;
    payload: ListingDraftPayload;
  }> {
    const live = await hydrateHolding(holding);
    const asset = holdingToSellingAsset(live);
    const sku = ensureSku(live);
    const payload = buildListingDraftPayload({ ...asset, sku });
    const idempotencyKey = `${live.id}:ebay:single`;
    const existing = await deps.store.findListingByIdempotency(idempotencyKey);
    if (existing && (ACTIVE_LISTING_STATUSES as readonly string[]).includes(existing.status)) {
      return { listing: existing, payload };
    }
    const listings = await deps.store.listListings();
    const lots = await deps.store.listLots();
    assertListingExclusivity({
      inventoryId: live.id,
      quantity: live.quantity,
      salesPathState: live.salesPathState ?? "available",
      existingListings: listings.filter((l) => l.inventoryId === live.id),
      lotMemberships: lots.flatMap((lot) =>
        lot.inventoryIds.map((id) => ({ lotId: lot.id, inventoryId: id, lotStatus: lot.status })),
      ),
      next: { kind: "single" },
    });
    const listing: MarketplaceListing = {
      id: existing?.id ?? randomUUID(),
      inventoryId: live.id,
      holdingUuid: live.holdingUuid ?? null,
      marketplace: "ebay",
      sku,
      listingKind: "single",
      externalOfferId: existing?.externalOfferId ?? null,
      externalListingId: existing?.externalListingId ?? null,
      listingFormat: payload.format,
      status: "READY_FOR_REVIEW",
      title: payload.title,
      categoryId: payload.categoryId,
      price: payload.recommendedListPrice,
      minimumOfferPrice: payload.minimumAcceptablePrice,
      quantity: payload.quantity,
      currency: payload.currency,
      paymentPolicyId: config()?.paymentPolicyId ?? null,
      returnPolicyId: config()?.returnPolicyId ?? null,
      fulfillmentPolicyId: config()?.fulfillmentPolicyId ?? null,
      merchantLocationKey: config()?.merchantLocationKey ?? null,
      promoted: false,
      fmvAtListing: asset.fmv,
      listedAt: null,
      endedAt: null,
      lastSyncedAt: null,
      idempotencyKey,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
      provenance: markInferred({
        source: "ebay_sell",
        ruleOrModelVersion: EBAY_SELL_RULE,
        confidence: 0.55,
        notes: "Draft payload from stored metadata · not published",
      }),
    };
    await deps.store.upsertListing(listing);
    await persistHolding(live, { ebaySku: sku });
    return { listing, payload };
  }

  async function approveAndPublish(holding: ApiHolding, listingId: string) {
    const listing = await deps.store.getListing(listingId);
    if (!listing) throw new Error("Listing not found");
    const live = await hydrateHolding(holding);
    const asset = holdingToSellingAsset(live);
    const payload = buildListingDraftPayload({ ...asset, sku: listing.sku });
    if (payload.publishBlockedReasons.length) {
      const errored = {
        ...listing,
        status: "ERROR" as const,
        errorClass: "non_retryable" as const,
        errorMessage: payload.publishBlockedReasons.join(", "),
        updatedAt: now(),
      };
      await deps.store.upsertListing(errored);
      return { listing: errored, published: false };
    }
    if (highValueRequiresApproval(asset.fmv?.mid ?? null, highValueUsd) && !autoPublishHighValue) {
      const approved = {
        ...listing,
        status: "APPROVED" as const,
        updatedAt: now(),
        errorMessage: `High-value (≥ $${highValueUsd}) — auto-publish disabled. Operator must enable EBAY_AUTO_PUBLISH_HIGH_VALUE or publish explicitly after review.`,
      };
      await deps.store.upsertListing(approved);
    }
    const health = await connection();
    const cfg = config();
    const policies = cfg ? policiesFromConfig(cfg) : null;
    if (!health.canPublish || !cfg || !policies) {
      const approved: MarketplaceListing = {
        ...listing,
        status: "APPROVED",
        errorClass: "non_retryable",
        errorMessage: `Cannot publish: ${health.blockers.join(", ") || "policies missing"}`,
        updatedAt: now(),
      };
      await deps.store.upsertListing(approved);
      return { listing: approved, published: false, connection: health };
    }
    if (highValueRequiresApproval(asset.fmv?.mid ?? null, highValueUsd) && !autoPublishHighValue) {
      return { listing: await deps.store.getListing(listingId), published: false, connection: health };
    }
    const token = await deps.store.getToken();
    if (!token) throw new Error("eBay Sell user token missing");
    const client = createEbayHttpClient({
      env: cfg.env,
      accessToken: token.accessToken,
      fetchImpl: deps.fetchImpl,
      onAudit: (e) => deps.store.writeAudit(e),
    });
    const adapter = createInventoryAdapter(client);
    const result = await adapter.publishListing({
      listing: { ...listing, status: "APPROVED" },
      payload,
      policies,
    });
    const next: MarketplaceListing = {
      ...listing,
      status: result.status,
      externalOfferId: result.externalOfferId,
      externalListingId: result.externalListingId,
      errorClass: result.errorClass,
      errorMessage: result.errorMessage,
      listedAt: result.status === "PUBLISHED" || result.status === "ACTIVE" ? now() : listing.listedAt,
      updatedAt: now(),
    };
    await deps.store.upsertListing(next);
    if (next.status === "PUBLISHED" || next.status === "ACTIVE") {
      await persistHolding(live, {
        ebaySku: next.sku,
        salesPathState: next.listingKind === "lot" ? "listed_lot" : "listed_single",
      });
    }
    return { listing: next, published: next.status === "PUBLISHED" || next.status === "ACTIVE", connection: health };
  }

  async function ingestOrderLines(
    holdings: ApiHolding[],
    rawPayload: unknown,
  ): Promise<{ ingested: number; skipped: number; completions: SaleCompletionResult[] }> {
    const liveHoldings = await hydrateHoldings(holdings);
    const lines = normalizeEbayOrders(rawPayload);
    let ingested = 0;
    let skipped = 0;
    const completions: SaleCompletionResult[] = [];
    const bySku = new Map(liveHoldings.map((h) => [ensureSku(h), h]));
    for (const line of lines) {
      if (await deps.store.hasOrderLine(line.externalOrderId, line.externalLineItemId)) {
        skipped += 1;
        continue;
      }
      const listing = await deps.store.findListingBySku(line.sku);
      const holding =
        bySku.get(line.sku) ?? liveHoldings.find((h) => h.ebaySku === line.sku);
      const orderId = randomUUID();
      await deps.store.insertOrder(
        {
          id: orderId,
          marketplace: "ebay",
          externalOrderId: line.externalOrderId,
          orderCreatedAt: line.orderCreatedAt,
          orderStatus: line.orderStatus,
          buyerReference: line.buyerReference,
          grossTotal: line.salePrice,
          shippingCollected: line.shippingAllocated,
          taxAmount: line.taxAmount,
          currency: line.currency,
          fulfillmentStatus: line.fulfillmentStatus,
          shippedAt: line.shippedAt,
          deliveredAt: null,
          lastSyncedAt: now(),
        },
        [
          {
            id: randomUUID(),
            marketplaceOrderId: orderId,
            inventoryId: holding?.id ?? listing?.inventoryId ?? null,
            sku: line.sku,
            externalLineItemId: line.externalLineItemId,
            quantity: line.quantity,
            salePrice: line.salePrice,
            shippingAllocated: line.shippingAllocated,
            feeAllocated: null,
            promotionFeeAllocated: null,
            netProceeds: null,
            feeIsEstimate: true,
          },
        ],
      );
      ingested += 1;
      if (listing && listing.status !== "SOLD") {
        const done = completeSale({
          inventoryId: listing.inventoryId,
          sku: listing.sku,
          listing,
          actualSalePrice: line.salePrice,
          soldAt: line.orderCreatedAt,
          shippingAllocated: line.shippingAllocated,
          feeIsEstimate: true,
          currency: line.currency,
          externalOrderId: line.externalOrderId,
          externalLineItemId: line.externalLineItemId,
        });
        await deps.store.upsertListing({
          ...listing,
          status: "SOLD",
          endedAt: line.orderCreatedAt,
          updatedAt: now(),
        });
        await deps.store.insertObservation(done.observation);
        const soldHolding = holding ?? liveHoldings.find((h) => h.id === listing.inventoryId);
        if (soldHolding) {
          await persistHolding(soldHolding, {
            ebaySku: listing.sku,
            salesPathState: "sold",
            soldAt: line.orderCreatedAt,
          });
          await deps.store.insertDisposition({
            id: randomUUID(),
            inventoryId: listing.inventoryId,
            previousDisposition: soldHolding.currentDisposition ?? null,
            newDisposition: "HOLD",
            reasonCode: "ALREADY_SOLD",
            reasonText: "Checkout completed — do not relist.",
            confidence: 0.99,
            recommendedBy: "RULE",
            createdAt: now(),
          });
        } else {
          await deps.store.patchHolding(listing.inventoryId, {
            ebaySku: listing.sku,
            salesPathState: "sold",
            soldAt: line.orderCreatedAt,
          });
        }
        completions.push(done);
      }
    }
    return { ingested, skipped, completions };
  }

  async function syncOrders(holdings: ApiHolding[]) {
    const health = await connection();
    if (!health.canPublish) {
      return { ok: false, reason: "eBay Sell not connected — order sync idle", ...health };
    }
    const cfg = config()!;
    const token = await deps.store.getToken();
    const client = createEbayHttpClient({
      env: cfg.env,
      accessToken: token?.accessToken ?? "",
      fetchImpl: deps.fetchImpl,
      onAudit: (e) => deps.store.writeAudit(e),
    });
    const fulfillment = createFulfillmentAdapter(client);
    const res = await fulfillment.getOrders({ createdAfter: new Date(now().getTime() - 7 * 86_400_000) });
    if (!res.ok) {
      return { ok: false, reason: res.errorMessage, errorClass: res.errorClass };
    }
    const ingested = await ingestOrderLines(holdings, res.body);
    return { ok: true, ...ingested };
  }

  async function syncTraffic() {
    try {
      const listings = (await deps.store.listListings()).filter((l) => l.externalListingId);
      const cfg = config();
      const token = await deps.store.getToken();
      if (!cfg || !token) return { ok: false, reason: "idle", snapshots: 0 };
      const client = createEbayHttpClient({
        env: cfg.env,
        accessToken: token.accessToken,
        fetchImpl: deps.fetchImpl,
        onAudit: (e) => deps.store.writeAudit(e),
      });
      const analytics = createAnalyticsAdapter(client);
      const to = now();
      const from = new Date(to.getTime() - 7 * 86_400_000);
      const ids = listings.map((l) => l.externalListingId!).slice(0, 20);
      const res = await analytics.trafficReport({ from, to, listingIds: ids }, cfg.marketplaceId);
      if (!res.ok) return { ok: false, reason: res.errorMessage, snapshots: 0 };
      const map = new Map(listings.map((l) => [l.externalListingId!, l.id]));
      const snaps = normalizeTrafficRecords(map, res.body, now());
      await deps.store.insertMetrics(snaps);
      return { ok: true, snapshots: snaps.length };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e), snapshots: 0 };
    }
  }

  async function syncListingStates() {
    const health = await connection();
    if (!health.canPublish) {
      return { ok: false, reason: "eBay Sell not connected — listing sync idle", synced: 0, ...health };
    }
    const cfg = config();
    const token = await deps.store.getToken();
    if (!cfg || !token) {
      return { ok: false, reason: "eBay Sell not connected — listing sync idle", synced: 0, ...health };
    }
    const client = createEbayHttpClient({
      env: cfg.env,
      accessToken: token.accessToken,
      fetchImpl: deps.fetchImpl,
      onAudit: (e) => deps.store.writeAudit(e),
    });
    const adapter = createInventoryAdapter(client);
    const listings = await deps.store.listListings();
    let synced = 0;
    for (const listing of listings) {
      if (!listing.externalOfferId || listing.status === "SOLD") continue;
      const res = await adapter.getOffer(listing.externalOfferId);
      if (!res.ok) {
        await deps.store.upsertListing({
          ...listing,
          lastSyncedAt: now(),
          errorClass: res.errorClass,
          errorMessage: res.errorMessage,
          updatedAt: now(),
        });
        continue;
      }
      const nextStatus = listingStatusFromOffer(res.body, listing.status);
      const listingId = listingIdFromOffer(res.body);
      await deps.store.upsertListing({
        ...listing,
        status: nextStatus,
        externalListingId: listingId ?? listing.externalListingId,
        lastSyncedAt: now(),
        errorClass: null,
        errorMessage: null,
        updatedAt: now(),
      });
      synced += 1;
    }
    return { ok: true, synced, connection: health };
  }

  async function dashboard(holdings: ApiHolding[]) {
    const liveHoldings = await hydrateHoldings(holdings);
    const [listings, orders, lines, metrics, health] = await Promise.all([
      deps.store.listListings(),
      deps.store.listOrders(),
      deps.store.listOrderLines(),
      deps.store.listMetrics(),
      connection(),
    ]);
    const unlistedSellable = liveHoldings.filter((h) => {
      const asset = holdingToSellingAsset(h);
      const rec = recommendDisposition(asset);
      return (
        (h.salesPathState ?? "available") === "available" &&
        (rec.disposition === "SINGLE" || rec.disposition === "LOT" || rec.disposition === "BULK")
      );
    }).length;
    const kpis = computeEbayKpis({ listings, orders, lines, metrics, unlistedSellable });
    const today = new Date(now());
    today.setHours(0, 0, 0, 0);
    const week = new Date(today.getTime() - 7 * 86_400_000);
    const month = new Date(today.getTime() - 30 * 86_400_000);
    const salesIn = (since: Date) =>
      lines.filter((l) => {
        const order = orders.find((o) => o.id === l.marketplaceOrderId);
        return order && order.orderCreatedAt >= since;
      });
    const errors = listings.filter((l) => l.status === "ERROR");
    const stale = listings.filter((l) => {
      if (l.status !== "ACTIVE" && l.status !== "PUBLISHED") return false;
      if (!l.listedAt) return false;
      return now().getTime() - l.listedAt.getTime() >= 21 * 86_400_000;
    });
    const needsShip = orders.filter(
      (o) => o.fulfillmentStatus === "NOT_STARTED" || o.fulfillmentStatus === "IN_PROGRESS",
    );
    return {
      connection: health,
      kpis,
      cards: {
        activeListings: kpis.inventory.activeListings,
        salesToday: salesIn(today).length,
        sales7d: salesIn(week).length,
        sales30d: salesIn(month).length,
        gross: kpis.sales.grossSales,
        net: kpis.sales.netProceeds,
        netIsEstimate: kpis.sales.netIsEstimate,
        ordersNeedingShipment: needsShip.length,
        listingErrors: errors.length,
        staleListings: stale.length,
      },
      errors,
      stale,
    };
  }

  async function rebuildQueue(holdings: ApiHolding[]) {
    const date = now().toISOString().slice(0, 10);
    const events = await deps.store.listEvents();
    const liveHoldings = await hydrateHoldings(holdings);
    const items = buildDailyListingQueue({
      assets: liveHoldings.map(holdingToSellingAsset),
      events,
    });
    const stored: StoredQueueItem[] = items.map((item) => ({
      ...item,
      id: randomUUID(),
      queueDate: date,
    }));
    await deps.store.replaceQueue(date, stored);
    return stored;
  }

  async function actOnQueue(
    holdings: ApiHolding[],
    itemId: string,
    action: DailyQueueItem extends never ? never : "approve" | "edit" | "defer" | "hold" | "change_disposition" | "reject",
    note: string,
    disposition?: SellingDisposition,
  ) {
    const date = now().toISOString().slice(0, 10);
    const item = (await deps.store.listQueue(date)).find((q) => q.id === itemId);
    if (!item) throw new Error("Queue item not found");
    const holding = (await hydrateHoldings(holdings)).find((h) => h.id === item.inventoryId);
    if (!holding) throw new Error("Holding not found for queue item");
    await deps.store.updateQueueItem(itemId, { operatorAction: action, operatorNote: note });
    if (action === "hold" || action === "change_disposition" || action === "reject") {
      await recommendFor(holding, {
        disposition: disposition ?? (action === "hold" ? "HOLD" : item.disposition),
        reasonText: note || `Operator ${action}`,
      });
    }
    if (action === "approve") {
      const { listing } = await draftFromHolding(holding);
      return { item: { ...item, operatorAction: action, operatorNote: note }, listing };
    }
    return { item: { ...item, operatorAction: action, operatorNote: note }, listing: null };
  }

  async function lots(holdings: ApiHolding[]) {
    const liveHoldings = await hydrateHoldings(holdings);
    return proposeLots(liveHoldings.map(holdingToSellingAsset));
  }

  async function acceptLot(proposal: ReturnType<typeof proposeLots>[number]) {
    const lot: StoredLot = { ...proposal, id: randomUUID(), status: "accepted" };
    return deps.store.upsertLot(lot);
  }

  async function rejectLot(lotId: string) {
    const lots = await deps.store.listLots();
    const lot = lots.find((l) => l.id === lotId);
    if (!lot) throw new Error("Lot not found");
    return deps.store.upsertLot({ ...lot, status: "rejected" });
  }

  async function itemDetail(holdings: ApiHolding[], inventoryId: string) {
    const found = holdings.find((h) => h.id === inventoryId || h.holdingUuid === inventoryId);
    if (!found) return null;
    const holding = await hydrateHolding(found);
    const asset = holdingToSellingAsset(holding);
    const rec = recommendDisposition(asset);
    const [listings, observations, history, lots] = await Promise.all([
      deps.store.listListings(),
      deps.store.listObservations(inventoryId),
      deps.store.listDisposition(inventoryId),
      deps.store.listLots(),
    ]);
    const mine = listings.filter((l) => l.inventoryId === inventoryId);
    const metrics = (await deps.store.listMetrics()).filter((m) =>
      mine.some((l) => l.id === m.marketplaceListingId),
    );
    const orders = await deps.store.listOrders();
    const lines = (await deps.store.listOrderLines()).filter((l) => l.inventoryId === inventoryId);
    return {
      holding,
      asset,
      disposition: rec,
      listings: mine,
      traffic: metrics,
      orders: orders.filter((o) => lines.some((l) => l.marketplaceOrderId === o.id)),
      orderLines: lines,
      observations,
      decisionHistory: history,
      lots: lots.filter((lot) => lot.inventoryIds.includes(inventoryId)),
    };
  }

  async function experiments() {
    const stored = await deps.store.listExperiments();
    const seed = {
      experimentId: LOW_DOLLAR_EXPERIMENT.experimentId,
      name: LOW_DOLLAR_EXPERIMENT.name,
      startDate: new Date("2026-09-05"),
      endDate: null,
      hypothesis: LOW_DOLLAR_EXPERIMENT.hypothesis,
      cohortDefinition: { ...LOW_DOLLAR_EXPERIMENT.cohortDefinition },
      strategy: LOW_DOLLAR_EXPERIMENT.strategy,
      status: "draft" as const,
    };
    const list = stored.length ? stored : [seed];
    const evalResult = evaluateExperiment([]);
    return { experiments: list, evaluation: evalResult };
  }

  return {
    connection,
    startAuth,
    handleCallback,
    disconnect,
    recommendFor,
    draftFromHolding,
    approveAndPublish,
    ingestOrderLines,
    syncListingStates,
    syncOrders,
    syncTraffic,
    dashboard,
    rebuildQueue,
    actOnQueue,
    lots,
    acceptLot,
    rejectLot,
    itemDetail,
    experiments,
    ensureSku,
    orderLineKey,
    policies: () => {
      const cfg = config();
      return cfg ? policiesFromConfig(cfg) : null;
    },
  };
}

export type EbaySellService = ReturnType<typeof createEbaySellService>;

export function defaultPolicies(): BusinessPolicies | null {
  const cfg = ebaySellAuthFromEnv();
  return cfg ? policiesFromConfig(cfg) : null;
}
