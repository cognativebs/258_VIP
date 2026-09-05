import { markInferred } from "@vip/evidence";
import {
  DEFAULT_LOT_LABOR_MINUTES,
  DEFAULT_MIN_NET_PER_LABOR_MINUTE,
  LOT_BUILDER_RULE,
} from "./constants.js";
import { assertLotEligible } from "./exclusivity.js";
import { ESTIMATED_FEE_RATE, netPerLaborMinute, roundMoney } from "./pricing.js";
import type { LotProposal, SellingAssetInput } from "./schemas.js";

export type LotBuilderConfig = {
  minMembers?: number;
  maxMembers?: number;
  /** Individual FMV above this should not be absorbed into a cheap lot. */
  individualCap?: number;
  laborMinutes?: number;
  minNetPerLaborMinute?: number;
};

type Grouper = {
  key: string;
  name: (members: SellingAssetInput[]) => string;
  of: (a: SellingAssetInput) => string | null;
};

const GROUPERS: Grouper[] = [
  {
    key: "player",
    name: (m) => `${m[0]?.playerSubject ?? "Player"} ${m.length}-Card Lot`,
    of: (a) => a.playerSubject?.trim() || null,
  },
  {
    key: "team",
    name: (m) => `${m[0]?.team ?? "Team"} ${m.length}-Card Lot`,
    of: (a) => a.team?.trim() || null,
  },
  {
    key: "set",
    name: (m) => `${m[0]?.setName ?? "Set"} ${m.length}-Card Lot`,
    of: (a) => a.setName?.trim() || null,
  },
  {
    key: "year_set",
    name: (m) => `${m[0]?.year ?? ""} ${m[0]?.setName ?? "Set"} ${m.length}-Card Lot`.trim(),
    of: (a) => (a.year && a.setName ? `${a.year}|${a.setName}` : null),
  },
  {
    key: "rookie",
    name: (m) => `Rookie class ${m.length}-Card Lot`,
    of: (a) => (a.rookieFlag ? "rookie" : null),
  },
  {
    key: "parallel",
    name: (m) => `${m[0]?.parallel ?? "Parallel"} ${m.length}-Card Lot`,
    of: (a) => a.parallel?.trim() || null,
  },
  {
    key: "serial",
    name: (m) => `Serial-numbered ${m.length}-Card Lot`,
    of: (a) => (a.serialNumber ? "serial" : null),
  },
];

/**
 * Propose lots. Never auto-commits. PC/HOLD/GRADE are excluded.
 */
export function proposeLots(
  assets: SellingAssetInput[],
  config: LotBuilderConfig = {},
): LotProposal[] {
  const minMembers = config.minMembers ?? 3;
  const maxMembers = config.maxMembers ?? 20;
  const individualCap = config.individualCap ?? 8;
  const labor = config.laborMinutes ?? DEFAULT_LOT_LABOR_MINUTES;
  const minNet = config.minNetPerLaborMinute ?? DEFAULT_MIN_NET_PER_LABOR_MINUTE;

  const eligible = assets.filter((a) => {
    try {
      assertLotEligible(a.currentDisposition, a.inventoryId);
    } catch {
      return false;
    }
    const mid = a.fmv?.mid ?? 0;
    return mid > 0 && mid < individualCap && a.salesPathState === "available";
  });

  const seen = new Set<string>();
  const proposals: LotProposal[] = [];

  for (const grouper of GROUPERS) {
    const buckets = new Map<string, SellingAssetInput[]>();
    for (const asset of eligible) {
      const g = grouper.of(asset);
      if (!g) continue;
      const list = buckets.get(g) ?? [];
      list.push(asset);
      buckets.set(g, list);
    }
    for (const [groupKey, members] of buckets) {
      if (members.length < minMembers) continue;
      const slice = members.slice(0, maxMembers);
      const ids = slice.map((m) => m.inventoryId).sort();
      const fingerprint = `${grouper.key}:${ids.join(",")}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const proposal = scoreLot(slice, `${grouper.key}:${groupKey}`, grouper.name(slice), labor);
      if (proposal.netDollarsPerLaborMinute < minNet) continue;
      proposals.push(proposal);
    }
  }

  return proposals.sort((a, b) => b.lotScore - a.lotScore);
}

export function scoreLot(
  members: SellingAssetInput[],
  groupingKey: string,
  lotName: string,
  laborMinutes = DEFAULT_LOT_LABOR_MINUTES,
): LotProposal {
  const combinedFmv = roundMoney(members.reduce((s, m) => s + (m.fmv?.mid ?? 0), 0));
  const recommendedPrice = roundMoney(Math.max(0.99, combinedFmv * 0.95));
  const estimatedNet = roundMoney(recommendedPrice * (1 - ESTIMATED_FEE_RATE));
  const buyerCoherence = members.every((m) => m.playerSubject === members[0]?.playerSubject)
    ? 0.3
    : 0.15;
  const expectedSellThrough = 0.22;
  const laborSavings = 0.18;
  const shippingEfficiency = 0.12;
  const staleBonus = members.some((m) => m.saleVelocity === "stale") ? 0.08 : 0;
  const valueLoss = Math.min(0.25, Math.max(0, (combinedFmv - recommendedPrice) / Math.max(combinedFmv, 1)));
  const lotScore = Number(
    (buyerCoherence + expectedSellThrough + laborSavings + shippingEfficiency + staleBonus - valueLoss).toFixed(3),
  );
  const confidence = Math.min(0.88, 0.55 + members.length * 0.02);
  return {
    lotName,
    groupingKey,
    inventoryIds: members.map((m) => m.inventoryId),
    combinedFmv,
    recommendedPrice,
    estimatedNet,
    estimatedLaborMinutes: laborMinutes,
    netDollarsPerLaborMinute: netPerLaborMinute(estimatedNet, laborMinutes),
    confidence,
    lotScore,
    currency: "USD",
    reasonCodes: ["COHERENT_CLUSTER", groupingKey.split(":")[0] ?? "group"],
    provenance: markInferred({
      source: "lot_builder",
      ruleOrModelVersion: LOT_BUILDER_RULE,
      confidence,
      notes: "Proposal only · not auto-committed",
    }),
  };
}

export function exactMembership(proposal: LotProposal): string[] {
  return [...proposal.inventoryIds];
}
