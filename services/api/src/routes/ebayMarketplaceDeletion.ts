import type { Express, Request, Response } from "express";
import {
  acknowledgeEbayAccountDeletion,
  answerEbayChallenge,
  ebayDeletionStatus,
} from "../lib/comps/ebayMarketplaceDeletion.js";

function challengeCodeFrom(req: Request): string | undefined {
  const raw = req.query.challenge_code;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return undefined;
}

/**
 * GET ?challenge_code=… → { challengeResponse } only (eBay Save validation).
 * GET without a challenge → status (so the operator can prove the URL is live
 * before clicking Save).
 * POST → ack. VIP has no eBay user store; deletedRecords is always 0.
 */
export function registerEbayDeletionRoutes(app: Express): void {
  const path = "/api/ebay/marketplace-deletion";

  app.get(path, (req: Request, res: Response) => {
    const code = challengeCodeFrom(req);
    if (code === undefined || code.trim() === "") {
      res.json({
        ok: true,
        service: "vip-ebay-deletion",
        ...ebayDeletionStatus(),
        note: "Do not click eBay Save until this URL is public https and configured=true",
      });
      return;
    }
    const answer = answerEbayChallenge(code);
    if (answer.ok) {
      res.status(200).json(answer.body);
      return;
    }
    res.status(answer.status).json(answer.body);
  });

  app.post(path, (req: Request, res: Response) => {
    const ack = acknowledgeEbayAccountDeletion(req.body);
    const id = ack.notificationId ?? "none";
    console.log(
      `[ebay-deletion] notification ${id} — VIP stores no eBay user records; deletedRecords=0`,
    );
    res.status(200).json(ack);
  });
}
