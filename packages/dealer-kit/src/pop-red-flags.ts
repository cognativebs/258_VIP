import type { GradeKey } from "./schemas.js";

export type PopRedFlagInput = {
  popCount?: number | null;
  category?: "cards" | "comics";
  ageYears?: number | null;
  gradeValues?: { grade: GradeKey; marketValue: number | null }[];
  salesVolumeYear?: number | null;
};

/**
 * When NOT to grade. High pop + compressed gem spread + low demand.
 * Flags are reasons, never an auto-clear of needs_review.
 */
export function populationRedFlags(input: PopRedFlagInput): string[] {
  const flags: string[] = [];
  const pop = input.popCount;
  const values = input.gradeValues ?? [];
  const v9 = values.find((g) => g.grade === "9")?.marketValue ?? null;
  const v10 = values.find((g) => g.grade === "10")?.marketValue ?? null;
  const v8 = values.find((g) => g.grade === "8")?.marketValue ?? null;
  const rawish = values.find((g) => g.grade === "7")?.marketValue ?? null;

  if (pop != null && pop >= 10000) {
    flags.push(
      `HIGH_POP_${pop} — census at this grade is a warehouse. Gem premiums vanish; buyers have endless choice.`,
    );
  } else if (pop != null && pop >= 2500) {
    flags.push(`CROWDED_POP_${pop} — only grade if the copy is truly 10-looking and the 10/9 spread still pays fees.`);
  }

  if (input.ageYears != null && input.ageYears < 4 && (pop == null || pop > 500)) {
    flags.push("STILL_PRINTING_ERA — modern product is still entering the census. Wait or sell raw.");
  }

  if (v9 != null && v10 != null && v9 > 0 && v10 / v9 < 1.35) {
    flags.push(
      `THIN_GEM_SPREAD — 10 is only ${((v10 / v9 - 1) * 100).toFixed(0)}% over 9. One 9 instead of 10 wipes the submission.`,
    );
  }

  if (v8 != null && v9 != null && v8 > 0 && v9 / v8 < 1.2) {
    flags.push("FLAT_MID_GRADES — 8 and 9 sell within 20%. You are paying fees to change a label, not a price.");
  }

  if (rawish != null && v9 != null && v9 < rawish * 1.15) {
    flags.push("RAW_ALREADY_PRICES_THE_9 — market is treating raw NM as a 9. Grading cannot manufacture demand.");
  }

  if (input.salesVolumeYear != null && input.salesVolumeYear < 12 && (pop ?? 0) > 200) {
    flags.push("LOW_DEMAND_HIGH_SUPPLY — fewer than 1 sale/month against a fat census. Liquidity trap.");
  }

  if (input.category === "comics" && pop != null && pop > 1500) {
    flags.push("COMIC_CENSUS_FAT — modern 9.8s of this issue are not scarce. Grade keys, not print-run wallpaper.");
  }

  return flags;
}

export const POP_RED_FLAG_GUIDE = [
  {
    id: "high-pop",
    title: "High pop",
    when: "2,500+ at the grade you need (10k+ is automatic no).",
    why: "Buyers will wait for a nicer copy at the same number.",
  },
  {
    id: "thin-spread",
    title: "Thin 10 / 9 spread",
    when: "PSA/CGC 10 sells <35% above the 9.",
    why: "The most common outcome (a 9) does not pay the ticket.",
  },
  {
    id: "modern-print",
    title: "Still-printing modern",
    when: "Set is <4 years old and census is already climbing.",
    why: "You are racing the print run. Sell raw or wait for a crash.",
  },
  {
    id: "no-demand",
    title: "Low demand",
    when: "<12 confirmed sales / year.",
    why: "A pretty slab that does not sell is inventory, not profit.",
  },
] as const;
