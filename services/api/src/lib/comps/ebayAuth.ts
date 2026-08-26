/**
 * eBay Browse OAuth for comics comps.
 *
 * Prefer a ready `EBAY_OAUTH_TOKEN`. Otherwise mint a client-credentials
 * application token from App ID + Cert ID and cache it until near expiry.
 * Default scope is `buy.browse`. Apps that were never granted Browse can
 * set `EBAY_OAUTH_SCOPE` to a scope on their client-credentials list
 * (often `https://api.ebay.com/oauth/api_scope`). Browse search may still
 * 403 — never fabricate comps.
 */

export const DEFAULT_EBAY_OAUTH_SCOPE =
  "https://api.ebay.com/oauth/api_scope/buy.browse";

export type EbayAuthMode = "oauth_token" | "client_credentials" | "idle";

export type EbayAuthStatus = {
  configured: boolean;
  mode: EbayAuthMode;
  environment: "production" | "sandbox";
  oauthScope: string;
};

type TokenCache = { accessToken: string; expiresAtMs: number; scope: string };

let tokenCache: TokenCache | null = null;

export function resetEbayAuthForTests(): void {
  tokenCache = null;
}

function environment(): "production" | "sandbox" {
  return process.env.EBAY_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
}

function apiHost(): string {
  return environment() === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

export function ebayAppId(): string {
  return (process.env.EBAY_APP_ID ?? process.env.EBAY_CLIENT_ID ?? "").trim();
}

export function ebayCertId(): string {
  return (process.env.EBAY_CERT_ID ?? process.env.EBAY_CLIENT_SECRET ?? "").trim();
}

/** Scope sent on client-credentials mint. Must be granted to the app. */
export function ebayOauthScope(): string {
  const override = process.env.EBAY_OAUTH_SCOPE?.trim();
  return override || DEFAULT_EBAY_OAUTH_SCOPE;
}

export function ebayAuthStatus(): EbayAuthStatus {
  const oauthScope = ebayOauthScope();
  const preset = process.env.EBAY_OAUTH_TOKEN?.trim();
  if (preset) {
    return { configured: true, mode: "oauth_token", environment: environment(), oauthScope };
  }
  if (ebayAppId() && ebayCertId()) {
    return {
      configured: true,
      mode: "client_credentials",
      environment: environment(),
      oauthScope,
    };
  }
  return { configured: false, mode: "idle", environment: environment(), oauthScope };
}

export const EBAY_IDLE_REASON =
  "eBay comps idle — set EBAY_APP_ID + EBAY_CERT_ID (or EBAY_OAUTH_TOKEN). No fabricated comps.";

export async function resolveEbayAccessToken(): Promise<
  { token: string } | { error: string }
> {
  const preset = process.env.EBAY_OAUTH_TOKEN?.trim();
  if (preset) return { token: preset };

  const scope = ebayOauthScope();
  if (tokenCache && tokenCache.scope === scope && Date.now() < tokenCache.expiresAtMs - 60_000) {
    return { token: tokenCache.accessToken };
  }

  const appId = ebayAppId();
  const certId = ebayCertId();
  if (!appId || !certId) {
    return { error: EBAY_IDLE_REASON };
  }

  const tokenUrl = `${apiHost()}/identity/v1/oauth2/token`;
  const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope,
  });

  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body,
      signal: AbortSignal.timeout(Number(process.env.VIP_COMPS_TIMEOUT_MS ?? 8000)),
    });
  } catch (e) {
    return {
      error: `eBay OAuth request failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const text = await res.text();
  if (!res.ok) {
    return { error: `eBay OAuth HTTP ${res.status} — ${text.slice(0, 180)}` };
  }
  let json: { access_token?: string; expires_in?: number };
  try {
    json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  } catch {
    return { error: "eBay OAuth: response was not JSON" };
  }
  if (!json.access_token) {
    return { error: "eBay OAuth: response missing access_token" };
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 7200;
  tokenCache = {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + expiresIn * 1000,
    scope,
  };
  return { token: json.access_token };
}
