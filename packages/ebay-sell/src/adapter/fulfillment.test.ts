import { describe, expect, it } from "vitest";
import { normalizeEbayOrders, orderLineKey } from "./fulfillment.js";

const payload = {
  orders: [
    {
      orderId: "ORD-1",
      creationDate: "2026-09-05T12:00:00.000Z",
      orderFulfillmentStatus: "NOT_STARTED",
      pricingSummary: { total: { currency: "USD", value: "12.00" } },
      buyer: { username: "buyer1" },
      lineItems: [
        {
          lineItemId: "LINE-1",
          sku: "IQV-SPORTS-AAAAAAAA",
          quantity: 1,
          lineItemCost: { value: "12.00", currency: "USD" },
          deliveryCost: { shippingCost: { value: "4.00" } },
        },
      ],
    },
  ],
};

describe("order ingestion", () => {
  it("normalizes orders and deduplicates on order+line id", () => {
    const a = normalizeEbayOrders(payload);
    const b = normalizeEbayOrders(payload);
    expect(a).toHaveLength(1);
    expect(a[0]?.sku).toBe("IQV-SPORTS-AAAAAAAA");
    expect(orderLineKey(a[0]!)).toBe("ORD-1::LINE-1");
    const keys = new Set([...a, ...b].map(orderLineKey));
    expect(keys.size).toBe(1);
  });
});
