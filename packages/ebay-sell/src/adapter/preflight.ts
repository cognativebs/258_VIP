import { DEFAULT_SELL_SCOPES } from "../constants.js";
import type {
  BusinessPolicies,
  EbayEnvironment,
  ListingDraftPayload,
  PreflightCheck,
  PreflightStatus,
  SellPreflightReport,
} from "../schemas.js";
import type { EbayHttpClient } from "./client.js";

export type SellPreflightInput = {
  /** User-token client. Every Sell API check goes through it. */
  client: EbayHttpClient;
  /**
   * Application-token client for the Taxonomy category check. Taxonomy needs
   * `api_scope`, which a Sell-scoped user token does not carry.
   */
  taxonomyClient?: EbayHttpClient | null;
  environment: EbayEnvironment;
  marketplaceId: string;
  policies: BusinessPolicies | null;
  scopes: string[];
  /** Representative draft. Without one the category and aspect checks skip. */
  payload?: ListingDraftPayload | null;
  now?: () => Date;
};

type PolicyKind = "fulfillment" | "payment" | "return";

const POLICY_LABEL: Record<PolicyKind, string> = {
  fulfillment: "Fulfillment (shipping) policy",
  payment: "Payment policy",
  return: "Return policy",
};

/**
 * Read-only rehearsal of everything publish depends on. It creates nothing on
 * eBay, so it is safe to run against Production. Every check reports its own
 * status and remediation rather than stopping at the first problem — one run
 * should surface every blocker between the operator and a live listing.
 */
export async function runSellPreflight(input: SellPreflightInput): Promise<SellPreflightReport> {
  const now = input.now ?? (() => new Date());
  const checks: PreflightCheck[] = [scopeCheck(input.scopes)];

  checks.push(await privilegeCheck(input.client));

  if (!input.policies) {
    checks.push({
      id: "policies",
      label: "Business policies",
      status: "fail",
      detail: "No policy IDs configured, so publish cannot build an offer.",
      fix: "Set EBAY_PAYMENT_POLICY_ID, EBAY_RETURN_POLICY_ID, EBAY_FULFILLMENT_POLICY_ID and EBAY_MERCHANT_LOCATION_KEY.",
    });
  } else {
    checks.push(await locationCheck(input.client, input.policies.merchantLocationKey, input.environment));
    for (const kind of ["fulfillment", "payment", "return"] as const) {
      checks.push(await policyCheck(input.client, kind, input.policies, input.marketplaceId));
    }
  }

  checks.push(...(await categoryChecks(input)));
  checks.push(draftCheck(input.payload ?? null));

  const failures = checks.filter((c) => c.status === "fail").length;
  return {
    ranAt: now(),
    environment: input.environment,
    marketplaceId: input.marketplaceId,
    ok: failures === 0,
    failures,
    warnings: checks.filter((c) => c.status === "warn").length,
    skipped: checks.filter((c) => c.status === "skip").length,
    checks,
  };
}

function scopeCheck(scopes: string[]): PreflightCheck {
  const missing = DEFAULT_SELL_SCOPES.filter((scope) => !scopes.includes(scope));
  const inventoryMissing = missing.some((scope) => scope.endsWith("sell.inventory"));
  if (!missing.length) {
    return {
      id: "scopes",
      label: "Granted OAuth scopes",
      status: "pass",
      detail: `All ${DEFAULT_SELL_SCOPES.length} Sell scopes are granted on the stored token.`,
      fix: null,
    };
  }
  return {
    id: "scopes",
    label: "Granted OAuth scopes",
    status: inventoryMissing ? "fail" : "warn",
    detail: `Token is missing ${missing.length} scope(s): ${missing.join(", ")}.`,
    fix: "Open /ebay and click Connect to re-consent with the full Sell scope set.",
  };
}

async function privilegeCheck(client: EbayHttpClient): Promise<PreflightCheck> {
  const res = await client.request({
    method: "GET",
    path: "/sell/account/v1/privilege",
    idempotencyKey: "preflight:privilege",
  });
  if (!res.ok) {
    return {
      id: "privilege",
      label: "Seller account privileges",
      status: res.status === 403 ? "warn" : "fail",
      detail: `GET /sell/account/v1/privilege returned HTTP ${res.status}: ${res.errorMessage ?? "no detail"}.`,
      fix: "Confirm the connected account is a registered seller and the token carries sell.account.readonly.",
    };
  }
  const body = asRecord(res.body);
  if (body?.sellerRegistrationCompleted === false) {
    return {
      id: "privilege",
      label: "Seller account privileges",
      status: "fail",
      detail: "eBay reports seller registration is not complete for this account.",
      fix: "Finish seller registration (billing + payout) for the connected account before publishing.",
    };
  }
  const limit = asRecord(body?.sellingLimit);
  const amount = asRecord(limit?.amount);
  const quantity = typeof limit?.quantity === "number" ? limit.quantity : null;
  const detail = [
    "Seller registration is complete.",
    quantity != null ? `Monthly listing limit ${quantity}.` : null,
    amount?.value ? `Monthly value limit ${String(amount.value)} ${String(amount.currency ?? "")}.`.trim() : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { id: "privilege", label: "Seller account privileges", status: "pass", detail, fix: null };
}

async function locationCheck(
  client: EbayHttpClient,
  merchantLocationKey: string,
  environment: EbayEnvironment,
): Promise<PreflightCheck> {
  const res = await client.request({
    method: "GET",
    path: `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`,
    idempotencyKey: `preflight:location:${merchantLocationKey}`,
  });
  if (res.ok) {
    const status = readString(res.body, "merchantLocationStatus");
    if (status && status !== "ENABLED") {
      return {
        id: "location",
        label: "Merchant inventory location",
        status: "fail",
        detail: `Location "${merchantLocationKey}" exists but is ${status}.`,
        fix: `Enable it: POST /sell/inventory/v1/location/${merchantLocationKey}/enable.`,
      };
    }
    return {
      id: "location",
      label: "Merchant inventory location",
      status: "pass",
      detail: `Inventory API location "${merchantLocationKey}" exists and is enabled.`,
      fix: null,
    };
  }
  const listed = await client.request({
    method: "GET",
    path: "/sell/inventory/v1/location?limit=50",
    idempotencyKey: "preflight:locations",
  });
  const keys = locationKeys(listed.body);
  const known = keys.length ? ` Existing Inventory API locations: ${keys.join(", ")}.` : " This account has no Inventory API locations yet.";
  return {
    id: "location",
    label: "Merchant inventory location",
    status: environment === "sandbox" ? "warn" : "fail",
    detail: `Location "${merchantLocationKey}" was not found (HTTP ${res.status}).${known}`,
    fix:
      environment === "sandbox"
        ? "Publish creates this location automatically on Sandbox. Set EBAY_MERCHANT_LOCATION_KEY to an existing key to skip that."
        : `Create it once with POST /sell/inventory/v1/location/${merchantLocationKey}, or point EBAY_MERCHANT_LOCATION_KEY at an existing key. Seller Hub locations are not Inventory API locations.`,
  };
}

async function policyCheck(
  client: EbayHttpClient,
  kind: PolicyKind,
  policies: BusinessPolicies,
  marketplaceId: string,
): Promise<PreflightCheck> {
  const configured = policies[`${kind}PolicyId` as keyof BusinessPolicies];
  const res = await client.request({
    method: "GET",
    path: `/sell/account/v1/${kind}_policy?marketplace_id=${encodeURIComponent(marketplaceId)}`,
    idempotencyKey: `preflight:${kind}-policy`,
  });
  if (!res.ok) {
    return {
      id: `${kind}-policy`,
      label: POLICY_LABEL[kind],
      status: "warn",
      detail: `Could not list ${kind} policies (HTTP ${res.status}: ${res.errorMessage ?? "no detail"}). Configured ID ${configured} is unverified.`,
      fix: "Grant sell.account.readonly so preflight can verify policy IDs before publish.",
    };
  }
  const found = policyIds(res.body, `${kind}Policies`, `${kind}PolicyId`);
  if (found.some((p) => p.id === configured)) {
    const match = found.find((p) => p.id === configured)!;
    return {
      id: `${kind}-policy`,
      label: POLICY_LABEL[kind],
      status: "pass",
      detail: `${configured} resolves to "${match.name}" on ${marketplaceId}.`,
      fix: null,
    };
  }
  return {
    id: `${kind}-policy`,
    label: POLICY_LABEL[kind],
    status: "fail",
    detail: found.length
      ? `Configured ID ${configured} is not one of this account's ${marketplaceId} ${kind} policies: ${found.map((p) => `${p.id} (${p.name})`).join(", ")}.`
      : `This account has no ${kind} policy on ${marketplaceId}.`,
    fix: found.length
      ? `Set EBAY_${kind.toUpperCase()}_POLICY_ID to one of the listed IDs.`
      : `Create a ${kind} policy in Seller Hub for ${marketplaceId}, then set EBAY_${kind.toUpperCase()}_POLICY_ID.`,
  };
}

async function categoryChecks(input: SellPreflightInput): Promise<PreflightCheck[]> {
  const payload = input.payload;
  if (!payload) {
    return [
      skip("category", "Listing category", "No draft payload supplied, so the category was not checked."),
      skip("aspects", "Required item aspects", "No draft payload supplied, so aspects were not checked."),
    ];
  }
  const client = input.taxonomyClient;
  if (!client) {
    return [
      skip(
        "category",
        "Listing category",
        `Category ${payload.categoryId} is unverified — no application token available for the Taxonomy API.`,
      ),
      skip("aspects", "Required item aspects", "Aspect requirements are unverified without the Taxonomy API."),
    ];
  }
  const tree = await client.request({
    method: "GET",
    path: `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(input.marketplaceId)}`,
    idempotencyKey: "preflight:category-tree",
  });
  const treeId = readString(tree.body, "categoryTreeId");
  if (!tree.ok || !treeId) {
    return [
      skip(
        "category",
        "Listing category",
        `Taxonomy lookup failed (HTTP ${tree.status}: ${tree.errorMessage ?? "no detail"}). Category ${payload.categoryId} is unverified.`,
      ),
      skip("aspects", "Required item aspects", "Aspect requirements are unverified without the Taxonomy API."),
    ];
  }
  const aspectsRes = await client.request({
    method: "GET",
    path: `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeId)}/get_item_aspects_for_category?category_id=${encodeURIComponent(payload.categoryId)}`,
    idempotencyKey: `preflight:aspects:${payload.categoryId}`,
  });
  if (!aspectsRes.ok) {
    return [
      {
        id: "category",
        label: "Listing category",
        status: "fail",
        detail: `eBay rejected category ${payload.categoryId} on ${input.marketplaceId} (HTTP ${aspectsRes.status}: ${aspectsRes.errorMessage ?? "no detail"}). Offers can only use leaf categories.`,
        fix: "Pick a current leaf category for this asset kind and update CATEGORY_LEAF in the listing builder.",
      },
      skip("aspects", "Required item aspects", "Aspect requirements could not be read for an invalid category."),
    ];
  }
  const required = requiredAspectNames(aspectsRes.body);
  const supplied = Object.keys(payload.aspects ?? {});
  const missing = required.filter((name) => !supplied.includes(name));
  return [
    {
      id: "category",
      label: "Listing category",
      status: "pass",
      detail: `Category ${payload.categoryId} is a valid leaf on ${input.marketplaceId} (tree ${treeId}).`,
      fix: null,
    },
    missing.length
      ? {
          id: "aspects",
          label: "Required item aspects",
          status: "fail" as PreflightStatus,
          detail: `Category ${payload.categoryId} requires ${required.length} aspect(s); the draft is missing ${missing.join(", ")}.`,
          fix: "Map these aspects in buildAspects from stored catalog fields. Do not invent values for data the record does not have.",
        }
      : {
          id: "aspects",
          label: "Required item aspects",
          status: "pass" as PreflightStatus,
          detail: required.length
            ? `All ${required.length} required aspect(s) are present: ${required.join(", ")}.`
            : `Category ${payload.categoryId} has no required aspects.`,
          fix: null,
        },
  ];
}

function draftCheck(payload: ListingDraftPayload | null): PreflightCheck {
  if (!payload) {
    return skip("draft", "Draft payload", "No draft payload supplied.");
  }
  if (payload.publishBlockedReasons.length) {
    return {
      id: "draft",
      label: "Draft payload",
      status: "fail",
      detail: `The sample draft is blocked: ${payload.publishBlockedReasons.join(", ")}.`,
      fix: "Resolve the blockers on the holding (images and identity fields) before publishing it.",
    };
  }
  if (payload.recommendedListPrice == null) {
    return {
      id: "draft",
      label: "Draft payload",
      status: "fail",
      detail: "The sample draft has no recommended list price, so the offer would carry an empty price.",
      fix: "Give the holding an FMV range before publishing it.",
    };
  }
  return {
    id: "draft",
    label: "Draft payload",
    status: "pass",
    detail: `Draft "${payload.title}" is publishable at ${payload.recommendedListPrice} ${payload.currency} with ${payload.imageUrls.length} image(s).`,
    fix: null,
  };
}

function skip(id: string, label: string, detail: string): PreflightCheck {
  return { id, label, status: "skip", detail, fix: null };
}

function requiredAspectNames(body: unknown): string[] {
  const rows = asRecord(body)?.aspects;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => asRecord(asRecord(row)?.aspectConstraint)?.aspectRequired === true)
    .map((row) => readString(row, "localizedAspectName"))
    .filter((name): name is string => Boolean(name));
}

function policyIds(body: unknown, listKey: string, idKey: string): { id: string; name: string }[] {
  const rows = asRecord(body)?.[listKey];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({ id: readString(row, idKey), name: readString(row, "name") ?? "unnamed" }))
    .filter((row): row is { id: string; name: string } => Boolean(row.id));
}

function locationKeys(body: unknown): string[] {
  const rows = asRecord(body)?.locations;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => readString(row, "merchantLocationKey"))
    .filter((key): key is string => Boolean(key));
}

function readString(body: unknown, key: string): string | null {
  const rec = asRecord(body);
  const value = rec?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}
