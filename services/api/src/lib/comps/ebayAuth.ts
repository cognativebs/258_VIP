/**
 * eBay Browse OAuth for comics comps.
 *
 * Prefer a ready `EBAY_OAUTH_TOKEN`. Otherwise mint a client-credentials
 * application token from App ID + Cert ID (`buy.browse`) and cache it until
 * near expiry. Never invent a token or comps when credentials are missing.
 */

const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.browse";

export type EbayAuthMode = "oauth_token" | "client_credentials" | "idle";

export type EbayAuthStatus = {
  configured: boolean;
  mode: EbayAuthMode;
  environment: "production" | "sandbox";
};

type TokenCache = { accessToken: string; expiresAtMs: number };

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

export function ebayAuthStatus(): EbayAuthStatus {
  const preset = process.env.EBAY_OAUTH_TOKEN?.trim();
  if (preset) {
    return { configured: true, mode: "oauth_token", environment: environment() };
  }
  if (ebayAppId() && ebayCertId()) {
    return { configured: true, mode: "client_credentials", environment: environment() };
  }
  return { configured: false, mode: "idle", environment: environment() };
}

export const EBAY_IDLE_REASON =
  "eBay comps idle — set EBAY_APP_ID + EBAY_CERT_ID (or EBAY_OAUTH_TOKEN). No fabricated comps.";

export async function resolveEbayAccessToken(): Promise<
  { token: string } | { error: string }
> {
  const preset = process.env.EBAY_OAUTH_TOKEN?.trim();
  if (preset) return { token: preset };

  if (tokenCache && Date.now() < tokenCache.expiresAtMs - 60_000) {
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
    scope: BROWSE_SCOPE,
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
  };
  return { token: json.access_token };
}
