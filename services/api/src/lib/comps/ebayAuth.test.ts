import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EBAY_IDLE_REASON,
  ebayAuthStatus,
  resetEbayAuthForTests,
  resolveEbayAccessToken,
} from "./ebayAuth.js";
import { applyEnvFile, parseEnvFile } from "../loadEnv.js";

afterEach(() => {
  resetEbayAuthForTests();
  delete process.env.EBAY_OAUTH_TOKEN;
  delete process.env.EBAY_APP_ID;
  delete process.env.EBAY_CERT_ID;
  delete process.env.EBAY_CLIENT_ID;
  delete process.env.EBAY_CLIENT_SECRET;
  delete process.env.EBAY_ENVIRONMENT;
  delete process.env.EBAY_OAUTH_SCOPE;
  vi.unstubAllGlobals();
});

describe("ebayAuth", () => {
  it("is idle without credentials and does not invent a token", async () => {
    expect(ebayAuthStatus()).toEqual({
      configured: false,
      mode: "idle",
      environment: "production",
      oauthScope: "https://api.ebay.com/oauth/api_scope/buy.browse",
    });
    await expect(resolveEbayAccessToken()).resolves.toEqual({ error: EBAY_IDLE_REASON });
  });

  it("uses a ready EBAY_OAUTH_TOKEN without calling eBay", async () => {
    process.env.EBAY_OAUTH_TOKEN = "preset-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveEbayAccessToken()).resolves.toEqual({ token: "preset-token" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ebayAuthStatus().mode).toBe("oauth_token");
  });

  it("mints and caches a client-credentials token from App ID + Cert ID", async () => {
    process.env.EBAY_APP_ID = "app";
    process.env.EBAY_CERT_ID = "cert";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ access_token: "minted-token", expires_in: 7200 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveEbayAccessToken()).resolves.toEqual({ token: "minted-token" });
    await expect(resolveEbayAccessToken()).resolves.toEqual({ token: "minted-token" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const mintedBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(mintedBody).toContain(
      encodeURIComponent("https://api.ebay.com/oauth/api_scope/buy.browse"),
    );
    expect(ebayAuthStatus().mode).toBe("client_credentials");
  });

  it("mints with EBAY_OAUTH_SCOPE when the app was not granted buy.browse", async () => {
    process.env.EBAY_APP_ID = "app";
    process.env.EBAY_CERT_ID = "cert";
    process.env.EBAY_OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ access_token: "public-scope-token", expires_in: 7200 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveEbayAccessToken()).resolves.toEqual({ token: "public-scope-token" });
    const mintedBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(mintedBody).toContain(encodeURIComponent("https://api.ebay.com/oauth/api_scope"));
    expect(mintedBody).not.toContain("buy.browse");
    expect(ebayAuthStatus().oauthScope).toBe("https://api.ebay.com/oauth/api_scope");
  });

  it("surfaces OAuth HTTP failures instead of fabricating a token", async () => {
    process.env.EBAY_APP_ID = "app";
    process.env.EBAY_CERT_ID = "cert";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "invalid_client",
      }),
    );
    const result = await resolveEbayAccessToken();
    expect(result).toEqual({ error: expect.stringMatching(/eBay OAuth HTTP 401/) });
  });
});

describe("loadEnv", () => {
  it("parses KEY=VALUE and does not override existing env", () => {
    expect(parseEnvFile('EBAY_APP_ID=abc\n# skip\nEBAY_CERT_ID="def ghi"\n')).toEqual({
      EBAY_APP_ID: "abc",
      EBAY_CERT_ID: "def ghi",
    });
    const env: NodeJS.ProcessEnv = { EBAY_APP_ID: "keep" };
    expect(applyEnvFile("EBAY_APP_ID=new\nEBAY_CERT_ID=secret", env)).toEqual(["EBAY_CERT_ID"]);
    expect(env.EBAY_APP_ID).toBe("keep");
    expect(env.EBAY_CERT_ID).toBe("secret");
  });
});
