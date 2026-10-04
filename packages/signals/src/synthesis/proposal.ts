/**
 * Signal proposals (pure): what SIGNALS proposes for a synthesized signal,
 * given your exposure. Orchestr8 decides; this never does. Actions use the
 * repo's vocabulary (AGENTS rule 1 + the decision engine's Watch); the spec's
 * finer actions become tags (operator decision 2026-10-04).
 *
 * Hard rule (spec 31): no Buy, Sell or Grade comes from SIGNALS while market
 * data is absent — they are listed as withheld, with the reason, so Orchestr8
 * can see what would need confirming.
 */
import { z } from "zod";
import type { Band } from "./synthesis.js";

export const PROPOSAL_VERSION = "signal-proposal@0.1.0";

export const ProposalActionSchema = z.enum(["Buy", "Hold", "Grade", "Sell", "Lot", "Pass", "Watch"]);
export type ProposalAction = z.infer<typeof ProposalActionSchema>;

export const ProposalTagSchema = z.enum(["research", "binder_target", "hunt_target", "sealed_target"]);
export type ProposalTag = z.infer<typeof ProposalTagSchema>;

export type SignalExposure = {
  owned: number;
  wishlist: number;
  hunts: string[];
  /** What matched, for the reasons line. */
  matched: string[];
};

export type ProposalInput = {
  title: string;
  theme: string;
  band: Band;
  direction: string;
  independentSourceCount: number;
  method: string;
  baseConfidence: number;
  exposure: SignalExposure;
  marketConfirmed: boolean;
};

export const SignalProposalSchema = z
  .object({
    version: z.literal(PROPOSAL_VERSION),
    action: ProposalActionSchema,
    tags: z.array(ProposalTagSchema),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string().min(1)).min(1),
    trigger: z.string().nullable(),
    withheld: z.array(z.object({ action: ProposalActionSchema, reason: z.string() }).strict()),
    verification: z.literal("unverified"),
  })
  .strict();
export type SignalProposal = z.infer<typeof SignalProposalSchema>;

const PRODUCT_THEMES = new Set(["PREORDER", "PRODUCT_REVEAL", "SET_RELEASE", "RESTOCK"]);
const RESEARCH_THEMES = new Set(["PULL_RATE", "CARD_REVEAL", "SUPPLY_CHANGE", "REPRINT"]);
const NEEDS_MARKET = "needs sold comps (market data) first";

export function proposeForSignal(input: ProposalInput): SignalProposal {
  const { exposure } = input;
  const reasons: string[] = [];
  const tags = new Set<ProposalTag>();
  const withheld: SignalProposal["withheld"] = [];
  let action: ProposalAction;
  let trigger: string | null = null;

  reasons.push(
    `${input.band.replace("_", " ")} · ${input.independentSourceCount} independent source${input.independentSourceCount === 1 ? "" : "s"}`,
  );
  if (exposure.matched.length) reasons.push(`Matches your collection: ${exposure.matched.slice(0, 4).join(", ")}`);

  if (input.band === "noise") {
    action = "Pass";
    reasons.push("Below the Watch band");
  } else if (exposure.owned > 0) {
    action = "Hold";
    reasons.push(`You own ${exposure.owned} matching card${exposure.owned === 1 ? "" : "s"}`);
    if (input.direction === "down") withheld.push({ action: "Sell", reason: `reads down for existing copies; Sell ${NEEDS_MARKET}` });
    if (input.direction === "up") withheld.push({ action: "Grade", reason: `upside for owned copies; Grade ${NEEDS_MARKET}` });
  } else if (exposure.wishlist > 0 || exposure.hunts.length > 0) {
    action = "Watch";
    if (exposure.wishlist > 0) {
      tags.add("binder_target");
      reasons.push(`${exposure.wishlist} matching Binder wishlist slot${exposure.wishlist === 1 ? "" : "s"}`);
    }
    if (exposure.hunts.length > 0) {
      tags.add("hunt_target");
      reasons.push(`In your hunts: ${exposure.hunts.slice(0, 3).join(", ")}`);
    }
    withheld.push({ action: "Buy", reason: `on your wants; Buy ${NEEDS_MARKET} and a price` });
  } else if (input.band === "watch") {
    action = "Pass";
    reasons.push("No exposure in your Binder or hunts; noted, not acted on");
  } else {
    action = "Watch";
    reasons.push("No exposure yet, but strong enough to follow");
  }

  if (action === "Watch") {
    if (PRODUCT_THEMES.has(input.theme)) {
      tags.add("sealed_target");
      trigger = "Notify when it is available at MSRP";
    }
    if (RESEARCH_THEMES.has(input.theme)) tags.add("research");
  }
  if (input.method === "opinion") {
    reasons.push("From creator opinion, not reported fact");
    if (action !== "Pass" && action !== "Hold") action = "Watch";
  }
  if (!input.marketConfirmed && action !== "Pass" && !withheld.some((w) => w.action === "Buy") && exposure.owned === 0) {
    withheld.push({ action: "Buy", reason: NEEDS_MARKET });
  }

  return SignalProposalSchema.parse({
    version: PROPOSAL_VERSION,
    action,
    tags: [...tags],
    confidence: Math.round(input.baseConfidence * 1000) / 1000,
    reasons,
    trigger,
    withheld,
    verification: "unverified",
  });
}

/** The question an Orchestr8 council run starts from. */
export function orchestr8Question(input: ProposalInput, proposal: SignalProposal): string {
  const e = input.exposure;
  return [
    `Evaluate this SIGNALS proposal for a Pokémon collector: "${input.title}" (${input.theme}, ${input.band.replace("_", " ")}, ${input.independentSourceCount} independent source(s)).`,
    `SIGNALS proposes ${proposal.action}${proposal.tags.length ? ` [${proposal.tags.join(", ")}]` : ""}${proposal.trigger ? `; trigger: ${proposal.trigger}` : ""}.`,
    `Exposure: owned ${e.owned}, wishlist ${e.wishlist}, hunts ${e.hunts.length ? e.hunts.join(", ") : "none"}.`,
    proposal.withheld.length ? `Withheld: ${proposal.withheld.map((w) => `${w.action} (${w.reason})`).join("; ")}.` : "",
    "Decide Buy / Hold / Grade / Sell / Lot / Pass / Watch with confidence and reasons. Buy, Sell or Grade only with market evidence; news is never a price.",
  ]
    .filter(Boolean)
    .join(" ");
}
