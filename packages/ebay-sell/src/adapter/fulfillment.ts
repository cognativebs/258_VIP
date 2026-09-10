import type { EbayHttpClient } from "./client.js";

export type EbayOrderLine = {
  externalOrderId: string;
  externalLineItemId: string;
  sku: string;
  quantity: number;
  salePrice: number;
  shippingAllocated: number | null;
  taxAmount: number | null;
  currency: string;
  orderStatus: string;
  fulfillmentStatus: string | null;
  orderCreatedAt: Date;
  buyerReference: string | null;
  shippedAt: Date | null;
};

export function createFulfillmentAdapter(client: EbayHttpClient) {
  return {
    async getOrders(opts: { limit?: number; offset?: number; createdAfter?: Date } = {}) {
      const params = new URLSearchParams();
      params.set("limit", String(opts.limit ?? 50));
      if (opts.offset) params.set("offset", String(opts.offset));
      if (opts.createdAfter) {
        params.set(
          "filter",
          `creationdate:[${opts.createdAfter.toISOString()}..]`,
        );
      }
      return client.request({
        method: "GET",
        path: `/sell/fulfillment/v1/order?${params.toString()}`,
        idempotencyKey: `orders:${params.toString()}`,
      });
    },

    async getOrder(orderId: string) {
      return client.request({
        method: "GET",
        path: `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`,
        idempotencyKey: `order:${orderId}`,
      });
    },
  };
}

export function normalizeEbayOrders(payload: unknown): EbayOrderLine[] {
  const orders = asArray(payload, "orders");
  const lines: EbayOrderLine[] = [];
  for (const order of orders) {
    const externalOrderId = str(order.orderId);
    if (!externalOrderId) continue;
    const currency = str(order.pricingSummary?.total?.currency) || "USD";
    const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
    for (const line of lineItems) {
      const sku = str(line.sku);
      const lineId = str(line.lineItemId);
      if (!sku || !lineId) continue;
      lines.push({
        externalOrderId,
        externalLineItemId: lineId,
        sku,
        quantity: Number(line.quantity ?? 1) || 1,
        salePrice: num(line.lineItemCost?.value) ?? 0,
        shippingAllocated: num(line.deliveryCost?.shippingCost?.value),
        taxAmount: num(line.ebayCollectAndRemitTaxes?.[0]?.amount?.value),
        currency,
        orderStatus: str(order.orderFulfillmentStatus) || str(order.orderPaymentStatus) || "UNKNOWN",
        fulfillmentStatus: str(order.orderFulfillmentStatus),
        orderCreatedAt: new Date(str(order.creationDate) || Date.now()),
        buyerReference: str(order.buyer?.username),
        shippedAt: null,
      });
    }
  }
  return lines;
}

export function orderLineKey(line: Pick<EbayOrderLine, "externalOrderId" | "externalLineItemId">): string {
  return `${line.externalOrderId}::${line.externalLineItemId}`;
}

function asArray(payload: unknown, key: string): Record<string, any>[] {
  if (!payload || typeof payload !== "object") return [];
  const v = (payload as Record<string, unknown>)[key];
  return Array.isArray(v) ? (v as Record<string, any>[]) : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
