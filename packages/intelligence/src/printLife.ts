import { z } from "zod";

/**
 * Print-life / supply-contraction monitor — SCHEMA + MANUAL ROWS ONLY.
 * Automated ACTIVE→OOP classification is blocked on Signals ingestion
 * (restock frequency, distributor availability, reprint signals).
 */
export const PrintLifeStageSchema = z.enum([
  "active_print",
  "declining_supply",
  "likely_final_wave",
  "effectively_oop",
]);
export type PrintLifeStage = z.infer<typeof PrintLifeStageSchema>;

export const PrintLifeWatchSchema = z.object({
  id: z.string(),
  setName: z.string(),
  released: z.string(),
  interestStars: z.number().int().min(1).max(5),
  stage: PrintLifeStageSchema,
  dataSource: z.literal("manual"),
  notes: z.string().nullable().optional(),
  buyAtRetail1299: z.enum(["buy_now", "interested", "some", "pass"]).nullable().optional(),
});
export type PrintLifeWatch = z.infer<typeof PrintLifeWatchSchema>;

export class PrintLifeBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintLifeBlockedError";
  }
}

export function classifyPrintLife(): never {
  throw new PrintLifeBlockedError(
    "Print-life classification is blocked until restock/distributor/reprint signals are live — record manual watches only",
  );
}

/** Sword & Shield tail + early SV watch list from the 2026-08-15 conversation. */
export const PRINT_LIFE_WATCHES: PrintLifeWatch[] = [
  { id: "evolving-skies", setName: "Evolving Skies", released: "2021-08", interestStars: 5, stage: "effectively_oop", dataSource: "manual", buyAtRetail1299: "buy_now", notes: "$12.99 sleeved → BUY immediately. Plus-tier SWSH." },
  { id: "fusion-strike", setName: "Fusion Strike", released: "2021-11", interestStars: 5, stage: "effectively_oop", dataSource: "manual", buyAtRetail1299: "interested" },
  { id: "brilliant-stars", setName: "Brilliant Stars", released: "2022-02", interestStars: 5, stage: "effectively_oop", dataSource: "manual", buyAtRetail1299: "interested" },
  { id: "battle-styles", setName: "Battle Styles", released: "2021-03", interestStars: 2, stage: "effectively_oop", dataSource: "manual", buyAtRetail1299: "pass" },
  { id: "chilling-reign", setName: "Chilling Reign", released: "2021-06", interestStars: 4, stage: "effectively_oop", dataSource: "manual", buyAtRetail1299: "interested" },
  { id: "astral-radiance", setName: "Astral Radiance", released: "2022-05", interestStars: 4, stage: "effectively_oop", dataSource: "manual", buyAtRetail1299: "some" },
  { id: "pokemon-go", setName: "Pokémon GO", released: "2022-07", interestStars: 2, stage: "effectively_oop", dataSource: "manual", buyAtRetail1299: "pass" },
  { id: "lost-origin", setName: "Lost Origin", released: "2022-09", interestStars: 5, stage: "effectively_oop", dataSource: "manual", buyAtRetail1299: "interested" },
  { id: "silver-tempest", setName: "Silver Tempest", released: "2022-11", interestStars: 5, stage: "effectively_oop", dataSource: "manual", buyAtRetail1299: "interested" },
  { id: "crown-zenith", setName: "Crown Zenith", released: "2023-01", interestStars: 5, stage: "effectively_oop", dataSource: "manual", buyAtRetail1299: "interested", notes: "Special set — no normal 36-pack box. Sleeved/pack format is the interesting SKU. Official OOP not confirmed; Pokémon reprints." },
  { id: "sv-base", setName: "Scarlet & Violet Base", released: "2023-03", interestStars: 3, stage: "declining_supply", dataSource: "manual", notes: "Do not label OOP yet. Track restock → reprint signals." },
  { id: "paldea-evolved", setName: "Paldea Evolved", released: "2023-06", interestStars: 3, stage: "declining_supply", dataSource: "manual" },
  { id: "obsidian-flames", setName: "Obsidian Flames", released: "2023-08", interestStars: 3, stage: "declining_supply", dataSource: "manual" },
  { id: "sv151", setName: "151", released: "2023-09", interestStars: 4, stage: "declining_supply", dataSource: "manual" },
  { id: "paradox-rift", setName: "Paradox Rift", released: "2023-11", interestStars: 3, stage: "active_print", dataSource: "manual" },
  { id: "paldean-fates", setName: "Paldean Fates", released: "2024-01", interestStars: 3, stage: "active_print", dataSource: "manual" },
  { id: "temporal-forces", setName: "Temporal Forces", released: "2024-03", interestStars: 3, stage: "active_print", dataSource: "manual" },
];
