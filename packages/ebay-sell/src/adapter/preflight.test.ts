import { describe, expect, it } from "vitest";
import { DEFAULT_SELL_SCOPES } from "../constants.js";
import { createEbayHttpClient } from "./client.js";
import { runSellPreflight } from "./preflight.js";
import { SellPreflightReportSchema, type ListingDraftPayload } from "../schemas.js";

const payload: ListingDraftPayload = {
  sku: "IQV-COMIC-AAAA",
  title: "2013 Age of Ultron #2A",
  description: "Exact identity.",
  categoryId: "63",
  format: "FIXED_PRICE",
  condition: "LIKE_NEW",
  imageUrls: ["https://img.example/front.jpg"],
  aspects: { Publisher: ["Marvel"], "Issue Number": ["2"] },
  marketplaceId: "EBAY_US",
  quantity: 1,
  recommendedListPrice: 14,
  minimumAcceptablePrice: 11,
  currency: "USD",
  publishBlockedReasons: [],
};

const policies = {
  paymentPolicyId: "PAY-1",
  returnPolicyId: "RET-1",
  fulfillmentPolicyId: "FUL-1",
  merchantLocationKey: "home",
};

/** Sandbox stand-in whose per-route answers each test can override. */
function stubClient(routes: Record<string, () => Response>) {
  return createEbayHttpClient({
    env: "sandbox",
    accessToken: "tok",
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      for (const [fragment, respond] of Object.entries(routes)) {
        if (url.includes(fragment)) return respond();
      }
      return new Response(JSON.stringify({ errors: [{ message: `unmocked ${url}` }] }), { status: 404 });
    },
  });
}

const healthyRoutes = {
  "/sell/account/v1/privilege": () =>
    new Response(JSON.stringify({ sellerRegistrationCompleted: true, sellingLimit: { quantity: 100 } }), {
      status: 200,
    }),
  "/sell/inventory/v1/location/home": () =>
    new Response(JSON.stringify({ merchantLocationKey: "home", merchantLocationStatus: "ENABLED" }), { status: 200 }),
  "/sell/account/v1/fulfillment_policy": () =>
    new Response(JSON.stringify({ fulfillmentPolicies: [{ fulfillmentPolicyId: "FUL-1", name: "Ship" }] }), {
      status: 200,
    }),
  "/sell/account/v1/payment_policy": () =>
    new Response(JSON.stringify({ paymentPolicies: [{ paymentPolicyId: "PAY-1", name: "Pay" }] }), { status: 200 }),
  "/sell/account/v1/return_policy": () =>
    new Response(JSON.stringify({ returnPolicies: [{ returnPolicyId: "RET-1", name: "Returns" }] }), { status: 200 }),
};

const taxonomyRoutes = {
  get_default_category_tree_id: () => new Response(JSON.stringify({ categoryTreeId: "0" }), { status: 200 }),
  get_item_aspects_for_category: () =>
    new Response(
      JSON.stringify({
        aspects: [
          { localizedAspectName: "Publisher", aspectConstraint: { aspectRequired: true } },
          { localizedAspectName: "Issue Number", aspectConstraint: { aspectRequired: true } },
          { localizedAspectName: "Signed", aspectConstraint: { aspectRequired: false } },
        ],
      }),
      { status: 200 },
    ),
};

function base(overrides: Partial<Parameters<typeof runSellPreflight>[0]> = {}) {
  return {
    client: stubClient(healthyRoutes),
    taxonomyClient: stubClient(taxonomyRoutes),
    environment: "sandbox" as const,
    marketplaceId: "EBAY_US",
    policies,
    scopes: [...DEFAULT_SELL_SCOPES],
    payload,
    now: () => new Date("2026-09-09T00:00:00Z"),
    ...overrides,
  };
}

function check(report: Awaited<ReturnType<typeof runSellPreflight>>, id: string) {
  const found = report.checks.find((c) => c.id === id);
  if (!found) throw new Error(`missing check ${id}`);
  return found;
}

describe("sell preflight", () => {
  it("passes a fully configured sandbox seller and matches the published contract", async () => {
    const report = await runSellPreflight(base());
    expect(SellPreflightReportSchema.parse(report)).toBeTruthy();
    expect(report.ok).toBe(true);
    expect(report.failures).toBe(0);
    expect(report.checks.map((c) => c.status)).not.toContain("fail");
  });

  it("creates nothing on eBay", async () => {
    const methods: string[] = [];
    const recording = createEbayHttpClient({
      env: "sandbox",
      accessToken: "tok",
      fetchImpl: async (input, init) => {
        methods.push(init?.method ?? "GET");
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        for (const [fragment, respond] of Object.entries(healthyRoutes)) {
          if (url.includes(fragment)) return respond();
        }
        return new Response("{}", { status: 200 });
      },
    });
    await runSellPreflight(base({ client: recording }));
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });

  it("names the real policy IDs when a configured ID does not exist", async () => {
    const report = await runSellPreflight(
      base({
        client: stubClient({
          ...healthyRoutes,
          "/sell/account/v1/return_policy": () =>
            new Response(JSON.stringify({ returnPolicies: [{ returnPolicyId: "RET-REAL", name: "30 day" }] }), {
              status: 200,
            }),
        }),
      }),
    );
    expect(report.ok).toBe(false);
    expect(check(report, "return-policy").status).toBe("fail");
    expect(check(report, "return-policy").detail).toMatch(/RET-REAL \(30 day\)/);
    expect(check(report, "payment-policy").status).toBe("pass");
  });

  it("lists the account's real location keys when the configured one is missing", async () => {
    const report = await runSellPreflight(
      base({
        environment: "production",
        client: stubClient({
          ...healthyRoutes,
          "/sell/inventory/v1/location/home": () =>
            new Response(JSON.stringify({ errors: [{ message: "not found" }] }), { status: 404 }),
          "/sell/inventory/v1/location?": () =>
            new Response(JSON.stringify({ locations: [{ merchantLocationKey: "warehouse_1" }] }), { status: 200 }),
        }),
      }),
    );
    expect(check(report, "location").status).toBe("fail");
    expect(check(report, "location").detail).toMatch(/warehouse_1/);
  });

  it("fails a category eBay will not accept and does not guess its aspects", async () => {
    const report = await runSellPreflight(
      base({
        taxonomyClient: stubClient({
          get_default_category_tree_id: () => new Response(JSON.stringify({ categoryTreeId: "0" }), { status: 200 }),
          get_item_aspects_for_category: () =>
            new Response(
              JSON.stringify({ errors: [{ errorId: 62002, message: "The category is not a leaf category." }] }),
              { status: 400 },
            ),
        }),
      }),
    );
    expect(check(report, "category").status).toBe("fail");
    expect(check(report, "category").detail).toMatch(/not a leaf/);
    expect(check(report, "aspects").status).toBe("skip");
  });

  it("names the required aspects a draft is missing", async () => {
    const report = await runSellPreflight(
      base({ payload: { ...payload, aspects: { Publisher: ["Marvel"] } } }),
    );
    expect(check(report, "aspects").status).toBe("fail");
    expect(check(report, "aspects").detail).toMatch(/Issue Number/);
  });

  it("reports an unverified category as skipped rather than healthy", async () => {
    const report = await runSellPreflight(base({ taxonomyClient: null }));
    expect(check(report, "category").status).toBe("skip");
    expect(report.skipped).toBeGreaterThan(0);
    expect(report.ok).toBe(true);
  });

  it("fails when the token is missing the inventory scope", async () => {
    const report = await runSellPreflight(
      base({ scopes: DEFAULT_SELL_SCOPES.filter((s) => !s.endsWith("sell.inventory")) }),
    );
    expect(check(report, "scopes").status).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("fails when no business policies are configured", async () => {
    const report = await runSellPreflight(base({ policies: null }));
    expect(check(report, "policies").status).toBe("fail");
    expect(check(report, "policies").fix).toMatch(/EBAY_MERCHANT_LOCATION_KEY/);
  });

  it("fails a draft that is blocked or has no price", async () => {
    const blocked = await runSellPreflight(
      base({ payload: { ...payload, publishBlockedReasons: ["IMAGE_REQUIRED"] } }),
    );
    expect(check(blocked, "draft").detail).toMatch(/IMAGE_REQUIRED/);
    const unpriced = await runSellPreflight(base({ payload: { ...payload, recommendedListPrice: null } }));
    expect(check(unpriced, "draft").status).toBe("fail");
  });
});
