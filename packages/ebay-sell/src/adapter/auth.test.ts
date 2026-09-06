import { describe, expect, it } from "vitest";
import {
  assertNoSecretsInLog,
  buildAuthorizationUrl,
  ebaySellAuthFromEnv,
  exchangeAuthorizationCode,
  redactSecrets,
  refreshUserToken,
  sellAuthStatus,
} from "./auth.js";

const config = {
  env: "sandbox" as const,
  appId: "app",
  certId: "cert",
  redirectUri: "https://example.test/api/ebay/sell/auth/callback",
  scopes: ["https://api.ebay.com/oauth/api_scope/sell.inventory"],
  marketplaceId: "EBAY_US",
  merchantLocationKey: "home",
  paymentPolicyId: "pay",
  returnPolicyId: "ret",
  fulfillmentPolicyId: "ful",
};

describe("eBay Sell OAuth", () => {
  it("stays idle without env and never logs tokens", () => {
    expect(ebaySellAuthFromEnv({})).toBeNull();
    const status = sellAuthStatus({ config: null, token: null });
    expect(status.connected).toBe(false);
    expect(status.mode).toBe("idle");
    expect(redactSecrets('Bearer abc.def Authorization: Bearer xyz "refresh_token":"sekrit"')).toContain(
      "[redacted]",
    );
    expect(() => assertNoSecretsInLog("Authorization: Bearer abc")).toThrow(/Authorization/);
  });

  it("builds an authorize URL and refreshes tokens via the token endpoint", async () => {
    const url = buildAuthorizationUrl(config, "state-1");
    expect(url).toContain("auth.sandbox.ebay.com/oauth2/authorize");
    expect(url).toContain("client_id=app");
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push(String(input));
      expect(String(init?.body)).not.toContain("access_token");
      return new Response(
        JSON.stringify({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 7200,
          scope: config.scopes[0],
        }),
        { status: 200 },
      );
    };
    const exchanged = await exchangeAuthorizationCode(config, "auth-code", fetchImpl);
    expect(exchanged.accessToken).toBe("access-1");
    const refreshed = await refreshUserToken(config, "refresh-1", fetchImpl);
    expect(refreshed.refreshToken).toBe("refresh-1");
    expect(calls.every((c) => c.includes("/identity/v1/oauth2/token"))).toBe(true);
  });
});
