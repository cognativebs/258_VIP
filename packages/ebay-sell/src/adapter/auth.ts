import { DEFAULT_SELL_SCOPES } from "../constants.js";
import type { EbayEnvironment, EbaySellAuthStatus } from "../schemas.js";

export type EbaySellAuthConfig = {
  env: EbayEnvironment;
  appId: string;
  certId: string;
  redirectUri: string;
  scopes?: string[];
  marketplaceId?: string;
  merchantLocationKey?: string | null;
  paymentPolicyId?: string | null;
  returnPolicyId?: string | null;
  fulfillmentPolicyId?: string | null;
};

export type StoredUserToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
};

export type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export function sellAuthHosts(env: EbayEnvironment): { api: string; auth: string } {
  return env === "sandbox"
    ? { api: "https://api.sandbox.ebay.com", auth: "https://auth.sandbox.ebay.com" }
    : { api: "https://api.ebay.com", auth: "https://auth.ebay.com" };
}

export function ebaySellAuthFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EbaySellAuthConfig | null {
  const appId = (env.EBAY_APP_ID ?? env.EBAY_CLIENT_ID ?? "").trim();
  const certId = (env.EBAY_CERT_ID ?? env.EBAY_CLIENT_SECRET ?? "").trim();
  const redirectUri = (env.EBAY_REDIRECT_URI ?? env.EBAY_RU_NAME ?? "").trim();
  if (!appId || !certId || !redirectUri) return null;
  const environment = env.EBAY_ENV === "production" || env.EBAY_ENVIRONMENT === "production"
    ? "production"
    : "sandbox";
  const scopeOverride = env.EBAY_SELL_OAUTH_SCOPE?.trim();
  return {
    env: environment,
    appId,
    certId,
    redirectUri,
    scopes: scopeOverride ? scopeOverride.split(/\s+/) : [...DEFAULT_SELL_SCOPES],
    marketplaceId: env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_US",
    merchantLocationKey: env.EBAY_MERCHANT_LOCATION_KEY?.trim() || null,
    paymentPolicyId: env.EBAY_PAYMENT_POLICY_ID?.trim() || null,
    returnPolicyId: env.EBAY_RETURN_POLICY_ID?.trim() || null,
    fulfillmentPolicyId: env.EBAY_FULFILLMENT_POLICY_ID?.trim() || null,
  };
}

export function buildAuthorizationUrl(config: EbaySellAuthConfig, state: string): string {
  const { auth } = sellAuthHosts(config.env);
  const scopes = (config.scopes ?? [...DEFAULT_SELL_SCOPES]).join(" ");
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: scopes,
    state,
  });
  return `${auth}/oauth2/authorize?${params.toString()}`;
}

export function sellAuthStatus(input: {
  config: EbaySellAuthConfig | null;
  token: StoredUserToken | null;
  lastError?: string | null;
}): EbaySellAuthStatus {
  const environment = input.config?.env ?? "sandbox";
  const marketplaceId = input.config?.marketplaceId ?? "EBAY_US";
  const policiesConfigured = Boolean(
    input.config?.paymentPolicyId &&
      input.config?.returnPolicyId &&
      input.config?.fulfillmentPolicyId &&
      input.config?.merchantLocationKey,
  );
  if (!input.config) {
    return {
      configured: false,
      connected: false,
      environment,
      marketplaceId,
      hasRefreshToken: false,
      tokenExpiresAt: null,
      scopes: [],
      policiesConfigured: false,
      merchantLocationKey: null,
      lastError: input.lastError ?? "eBay Sell OAuth idle — set EBAY_APP_ID, EBAY_CERT_ID, EBAY_REDIRECT_URI",
      mode: "idle",
    };
  }
  const connected = Boolean(input.token?.refreshToken);
  return {
    configured: true,
    connected,
    environment,
    marketplaceId,
    hasRefreshToken: Boolean(input.token?.refreshToken),
    tokenExpiresAt: input.token?.expiresAt ?? null,
    scopes: input.token?.scopes ?? input.config.scopes ?? [],
    policiesConfigured,
    merchantLocationKey: input.config.merchantLocationKey ?? null,
    lastError: connected ? input.lastError ?? null : input.lastError ?? "User has not authorized Sell scopes",
    mode: connected ? "user_oauth" : "idle",
  };
}

export function policiesFromConfig(config: EbaySellAuthConfig) {
  if (
    !config.paymentPolicyId ||
    !config.returnPolicyId ||
    !config.fulfillmentPolicyId ||
    !config.merchantLocationKey
  ) {
    return null;
  }
  return {
    paymentPolicyId: config.paymentPolicyId,
    returnPolicyId: config.returnPolicyId,
    fulfillmentPolicyId: config.fulfillmentPolicyId,
    merchantLocationKey: config.merchantLocationKey,
  };
}

export function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/("access_token"\s*:\s*")[^"]+/gi, "$1[redacted]")
    .replace(/("refresh_token"\s*:\s*")[^"]+/gi, "$1[redacted]")
    .replace(/(refresh_token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(access_token=)[^&\s]+/gi, "$1[redacted]");
}

export function assertNoSecretsInLog(line: string): void {
  const lower = line.toLowerCase();
  if (lower.includes("bearer ") && !lower.includes("[redacted]")) {
    throw new Error("Refusing to log an Authorization header");
  }
  if (/(access_token|refresh_token)\s*[:=]\s*[^[\s]/.test(lower) && !lower.includes("[redacted]")) {
    throw new Error("Refusing to log an OAuth token");
  }
}

export async function exchangeAuthorizationCode(
  config: EbaySellAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredUserToken> {
  return tokenRequest(config, { grant_type: "authorization_code", code, redirect_uri: config.redirectUri }, fetchImpl);
}

export async function refreshUserToken(
  config: EbaySellAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredUserToken> {
  const scopes = (config.scopes ?? [...DEFAULT_SELL_SCOPES]).join(" ");
  return tokenRequest(
    config,
    { grant_type: "refresh_token", refresh_token: refreshToken, scope: scopes },
    fetchImpl,
  );
}

async function tokenRequest(
  config: EbaySellAuthConfig,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<StoredUserToken> {
  const { api } = sellAuthHosts(config.env);
  const basic = Buffer.from(`${config.appId}:${config.certId}`).toString("base64");
  const res = await fetchImpl(`${api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  let json: TokenResponse;
  try {
    json = JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`eBay token response was not JSON (HTTP ${res.status})`);
  }
  if (!res.ok || !json.access_token) {
    throw new Error(
      `eBay token exchange failed HTTP ${res.status}${json.error ? ` · ${json.error}` : ""}`,
    );
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 7200;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? body.refresh_token ?? "",
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scopes: (json.scope ?? (config.scopes ?? []).join(" ")).split(/\s+/).filter(Boolean),
  };
}

export async function resolveUserAccessToken(
  config: EbaySellAuthConfig,
  stored: StoredUserToken,
  fetchImpl: typeof fetch = fetch,
  skewMs = 60_000,
): Promise<StoredUserToken> {
  if (stored.accessToken && stored.expiresAt.getTime() - Date.now() > skewMs) {
    return stored;
  }
  if (!stored.refreshToken) {
    throw new Error("eBay Sell refresh token missing — reconnect the seller account");
  }
  const next = await refreshUserToken(config, stored.refreshToken, fetchImpl);
  return {
    ...next,
    refreshToken: next.refreshToken || stored.refreshToken,
  };
}
