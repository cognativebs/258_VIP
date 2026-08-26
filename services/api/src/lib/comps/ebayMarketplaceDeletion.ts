/**
 * eBay Marketplace Account Deletion / Closure notifications.
 *
 * Production keysets require a public HTTPS endpoint that answers eBay's
 * GET challenge and accepts POST deletion notices. VIP Browse comps never
 * store eBay user accounts — POST is an honest ack with deletedRecords=0.
 *
 * Challenge hash (order is mandatory):
 *   SHA256(challengeCode + verificationToken + endpointURL)
 * endpointURL must be the exact string saved in the eBay developer portal.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { markInferred } from "@vip/evidence";

export const EBAY_DELETION_RULE = "ebay-marketplace-deletion@1.0.0";

/** eBay: 32–80 chars, letters / numbers / hyphen / underscore only. */
export const verificationTokenSchema = z
  .string()
  .min(32)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/, "letters, numbers, hyphen, underscore only");

/** Public portal URL — https only; no localhost. Must match the form exactly. */
export const endpointUrlSchema = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), "eBay requires https")
  .refine((u) => {
    try {
      const host = new URL(u).hostname.toLowerCase();
      return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
    } catch {
      return false;
    }
  }, "eBay cannot reach localhost");

export const ebayDeletionNotificationSchema = z.object({
  metadata: z
    .object({
      topic: z.string().optional(),
      schemaVersion: z.string().optional(),
    })
    .passthrough()
    .optional(),
  notification: z
    .object({
      notificationId: z.string().optional(),
      eventDate: z.string().optional(),
      publishDate: z.string().optional(),
      data: z
        .object({
          username: z.string().optional(),
          userId: z.string().optional(),
          eiasToken: z.string().optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .optional(),
});

export type EbayDeletionStatus = {
  configured: boolean;
  endpointUrl: string | null;
  tokenConfigured: boolean;
};

export function ebayDeletionStatus(
  env: NodeJS.ProcessEnv = process.env,
): EbayDeletionStatus {
  const token = (env.EBAY_DELETION_VERIFICATION_TOKEN ?? "").trim();
  const endpointUrl = (env.EBAY_DELETION_ENDPOINT_URL ?? "").trim();
  const tokenConfigured = verificationTokenSchema.safeParse(token).success;
  const urlParsed = endpointUrlSchema.safeParse(endpointUrl);
  return {
    configured: tokenConfigured && urlParsed.success,
    endpointUrl: urlParsed.success ? urlParsed.data : null,
    tokenConfigured,
  };
}

export function ebayChallengeResponseHex(
  challengeCode: string,
  verificationToken: string,
  endpointUrl: string,
): string {
  return createHash("sha256")
    .update(`${challengeCode}${verificationToken}${endpointUrl}`, "utf8")
    .digest("hex");
}

export type EbayChallengeAnswer =
  | { ok: true; status: 200; body: { challengeResponse: string } }
  | { ok: false; status: 400 | 503; body: { error: string } };

export function answerEbayChallenge(
  challengeCode: string | undefined,
  env: { token?: string; endpointUrl?: string } = {
    token: process.env.EBAY_DELETION_VERIFICATION_TOKEN,
    endpointUrl: process.env.EBAY_DELETION_ENDPOINT_URL,
  },
): EbayChallengeAnswer {
  const code = (challengeCode ?? "").trim();
  if (!code) {
    return { ok: false, status: 400, body: { error: "challenge_code query required" } };
  }
  const token = (env.token ?? "").trim();
  const endpointUrl = (env.endpointUrl ?? "").trim();
  const tokenParsed = verificationTokenSchema.safeParse(token);
  const urlParsed = endpointUrlSchema.safeParse(endpointUrl);
  if (!tokenParsed.success || !urlParsed.success) {
    return {
      ok: false,
      status: 503,
      body: {
        error:
          "eBay deletion endpoint not configured — set EBAY_DELETION_VERIFICATION_TOKEN (32–80) and EBAY_DELETION_ENDPOINT_URL (exact public https URL)",
      },
    };
  }
  return {
    ok: true,
    status: 200,
    body: {
      challengeResponse: ebayChallengeResponseHex(
        code,
        tokenParsed.data,
        urlParsed.data,
      ),
    },
  };
}

export function acknowledgeEbayAccountDeletion(body: unknown) {
  const parsed = ebayDeletionNotificationSchema.safeParse(body ?? {});
  const notificationId = parsed.success
    ? (parsed.data.notification?.notificationId ?? null)
    : null;
  return {
    acknowledged: true as const,
    deletedRecords: 0 as const,
    notificationId,
    note: "VIP stores no eBay user accounts or marketplace PII from Browse comps — nothing to delete. Notification accepted.",
    provenance: markInferred({
      source: "ebay_marketplace_deletion",
      ruleOrModelVersion: EBAY_DELETION_RULE,
      notes: "Ack only · VIP has no eBay user identity store",
    }),
  };
}
