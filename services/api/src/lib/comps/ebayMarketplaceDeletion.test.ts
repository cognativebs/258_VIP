import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgeEbayAccountDeletion,
  answerEbayChallenge,
  canonicalPublicEndpointUrl,
  ebayChallengeResponseHex,
  ebayDeletionStatus,
  endpointUrlSchema,
  verificationTokenSchema,
} from "./ebayMarketplaceDeletion.js";

const TOKEN = `vip-ebay-deletion-token-${"x".repeat(8)}`; // 32 chars
const ENDPOINT = "https://vip-ebay-deletion.example.workers.dev";

afterEach(() => {
  delete process.env.EBAY_DELETION_VERIFICATION_TOKEN;
  delete process.env.EBAY_DELETION_ENDPOINT_URL;
});

describe("ebay marketplace deletion contracts", () => {
  it("accepts eBay verification tokens and rejects short or punctuated ones", () => {
    expect(verificationTokenSchema.safeParse(TOKEN).success).toBe(true);
    expect(verificationTokenSchema.safeParse("too-short").success).toBe(false);
    expect(verificationTokenSchema.safeParse("a".repeat(31)).success).toBe(false);
    expect(verificationTokenSchema.safeParse(`${"a".repeat(30)}!`).success).toBe(false);
    expect(verificationTokenSchema.safeParse("a".repeat(81)).success).toBe(false);
  });

  it("canonical portal URL drops query and a root trailing slash", () => {
    expect(canonicalPublicEndpointUrl(`${ENDPOINT}/?challenge_code=abc`)).toBe(ENDPOINT);
    expect(canonicalPublicEndpointUrl(`${ENDPOINT}/`)).toBe(ENDPOINT);
    expect(canonicalPublicEndpointUrl(`${ENDPOINT}/api/ebay/marketplace-deletion/`)).toBe(
      `${ENDPOINT}/api/ebay/marketplace-deletion`,
    );
    expect(canonicalPublicEndpointUrl("https://127.0.0.1:8787/api/ebay")).toBeNull();
    expect(canonicalPublicEndpointUrl("http://example.workers.dev")).toBeNull();
  });

  it("requires a public https endpoint — never localhost", () => {
    expect(endpointUrlSchema.safeParse(ENDPOINT).success).toBe(true);
    expect(endpointUrlSchema.safeParse("http://example.com/ebay").success).toBe(false);
    expect(endpointUrlSchema.safeParse("https://127.0.0.1:8787/api/ebay").success).toBe(
      false,
    );
    expect(endpointUrlSchema.safeParse("https://localhost/api/ebay").success).toBe(false);
  });

  it("hashes challengeCode + token + endpointURL in that order (lowercase hex)", () => {
    const challenge = "challenge-from-ebay";
    const expected = createHash("sha256")
      .update(`${challenge}${TOKEN}${ENDPOINT}`, "utf8")
      .digest("hex");
    expect(ebayChallengeResponseHex(challenge, TOKEN, ENDPOINT)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    // Wrong concat order must not match.
    const swapped = createHash("sha256")
      .update(`${TOKEN}${challenge}${ENDPOINT}`, "utf8")
      .digest("hex");
    expect(ebayChallengeResponseHex(challenge, TOKEN, ENDPOINT)).not.toBe(swapped);
  });

  it("answers a challenge only when token + public URL are configured", () => {
    expect(answerEbayChallenge("abc").ok).toBe(false);
    expect(answerEbayChallenge("abc").status).toBe(503);
    const ok = answerEbayChallenge("abc", { token: TOKEN, endpointUrl: ENDPOINT });
    expect(ok).toEqual({
      ok: true,
      status: 200,
      body: { challengeResponse: ebayChallengeResponseHex("abc", TOKEN, ENDPOINT) },
    });
    expect(answerEbayChallenge("", { token: TOKEN, endpointUrl: ENDPOINT })).toEqual({
      ok: false,
      status: 400,
      body: { error: "challenge_code query required" },
    });
  });

  it("acks a deletion notice without inventing user-record deletes", () => {
    const ack = acknowledgeEbayAccountDeletion({
      metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" },
      notification: {
        notificationId: "n-1",
        data: { username: "someone", userId: "42" },
      },
    });
    expect(ack.acknowledged).toBe(true);
    expect(ack.deletedRecords).toBe(0);
    expect(ack.notificationId).toBe("n-1");
    expect(ack.provenance.verificationStatus).toBe("unverified");
    expect(ack.provenance.method).toBe("inferred");
  });

  it("reports configured only when both env values are valid", () => {
    expect(ebayDeletionStatus({})).toEqual({
      configured: false,
      endpointUrl: null,
      tokenConfigured: false,
    });
    process.env.EBAY_DELETION_VERIFICATION_TOKEN = TOKEN;
    process.env.EBAY_DELETION_ENDPOINT_URL = ENDPOINT;
    expect(ebayDeletionStatus()).toEqual({
      configured: true,
      endpointUrl: ENDPOINT,
      tokenConfigured: true,
    });
  });
});
