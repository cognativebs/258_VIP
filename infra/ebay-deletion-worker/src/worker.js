/**
 * Public HTTPS front for eBay Marketplace Account Deletion.
 *
 * Keep the challenge hash in lockstep with
 * services/api/src/lib/comps/ebayMarketplaceDeletion.ts:
 *   SHA256(challengeCode + verificationToken + endpointURL)
 *
 * Env (Cloudflare):
 *   VERIFICATION_TOKEN  — same 32–80 char token as the eBay portal
 *   ENDPOINT_URL        — optional exact portal URL; otherwise derived from
 *                         the request (https host, no query, no trailing slash)
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{32,80}$/;

/** Same rule as services/api canonicalPublicEndpointUrl — no trailing slash. */
function canonicalPublicEndpointUrl(requestUrl) {
  try {
    const parsed = new URL(requestUrl);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") return null;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return null;
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${path}`;
  } catch {
    return null;
  }
}

function isPublicHttps(url) {
  return canonicalPublicEndpointUrl(url) != null;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const token = String(env.VERIFICATION_TOKEN ?? "").trim();
    const explicit = String(env.ENDPOINT_URL ?? "").trim();
    const derived = canonicalPublicEndpointUrl(request.url);
    const portalUrl =
      explicit && isPublicHttps(explicit) ? explicit : derived;
    const configured = TOKEN_RE.test(token) && Boolean(portalUrl);
    const url = new URL(request.url);

    if (request.method === "GET") {
      const challenge = (url.searchParams.get("challenge_code") ?? "").trim();
      if (!challenge) {
        return json({
          ok: true,
          service: "vip-ebay-deletion",
          configured,
          endpointUrl: portalUrl,
          tokenConfigured: TOKEN_RE.test(token),
          note: "Do not click eBay Save until configured=true. Paste endpointUrl exactly (no extra slash).",
        });
      }
      if (!configured || !portalUrl) {
        return json(
          {
            error:
              "Worker not configured — set VERIFICATION_TOKEN (32–80). ENDPOINT_URL optional if this request is already public https.",
          },
          503,
        );
      }
      const challengeResponse = await sha256Hex(`${challenge}${token}${portalUrl}`);
      return json({ challengeResponse });
    }

    if (request.method === "POST") {
      let notificationId = null;
      try {
        const body = await request.json();
        notificationId = body?.notification?.notificationId ?? null;
      } catch {
        // eBay still needs a fast 200; body shape is not a reason to fail Save.
      }
      return json({
        acknowledged: true,
        deletedRecords: 0,
        notificationId,
        note: "VIP stores no eBay user accounts — notification accepted.",
      });
    }

    return json({ error: "method not allowed" }, 405);
  },
};
