import { describe, expect, it } from "vitest";
import {
  assertNoSecretsInLog,
  buildAuthorizationUrl,
  ebaySellAuthFromEnv,
  exchangeAuthorizationCode,
  mintApplicationToken,
  redactSecrets,
  refreshUserToken,
  resolveUserAccessToken,
  sellAuthStatus,
  sellEnvironmentFromEnv,
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
      const body = String(init?.body);
      expect(body).not.toContain("access_token");
      if (body.includes("grant_type=refresh_token")) {
        expect(body).not.toContain("scope=");
      }
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
    const resolved = await resolveUserAccessToken(
      config,
      { accessToken: "", refreshToken: "refresh-1", expiresAt: new Date(0), scopes: [] },
      fetchImpl,
    );
    expect(resolved.accessToken).toBe("access-1");
  });

  it("only reaches Production when EBAY_ENV asks for it", () => {
    const credentials = {
      EBAY_APP_ID: "app",
      EBAY_CERT_ID: "cert",
      EBAY_REDIRECT_URI: "https://example.test/cb",
    };
    // Comps run against Production by default, and env.example ships
    // EBAY_ENVIRONMENT=production for them. That must never drag publish along
    // with it and create real listings from what the operator thinks is a test.
    expect(sellEnvironmentFromEnv({ EBAY_ENVIRONMENT: "production" })).toBe("sandbox");
    expect(sellEnvironmentFromEnv({ EBAY_ENV: "sandbox", EBAY_ENVIRONMENT: "production" })).toBe("sandbox");
    expect(ebaySellAuthFromEnv({ ...credentials, EBAY_ENVIRONMENT: "production" })?.env).toBe("sandbox");
    expect(sellEnvironmentFromEnv({ EBAY_ENV: "production" })).toBe("production");
    expect(ebaySellAuthFromEnv({ ...credentials, EBAY_ENV: "production" })?.env).toBe("production");
    expect(sellEnvironmentFromEnv({})).toBe("sandbox");
  });

  it("names the environment that still needs consent", () => {
    // Consent is per environment. After switching, the status must not read as
    // if the connection was lost — Production simply has its own authorization.
    const status = sellAuthStatus({ config: { ...config, env: "production" }, token: null });
    expect(status.connected).toBe(false);
    expect(status.lastError).toBe("User has not authorized Sell scopes for production");
  });

  it("mints an application token for public read APIs", async () => {
    const bodies: string[] = [];
    const token = await mintApplicationToken(config, async (_url, init) => {
      bodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ access_token: "app-token", expires_in: 7200 }), { status: 200 });
    });
    expect(token).toBe("app-token");
    expect(bodies[0]).toContain("grant_type=client_credentials");
  });
});
