import { z } from "zod";

/**
 * Collectible Emerging Market Index — seed + manual stance only.
 * ACCUMULATE/OVERHEATED automation waits on Signals (velocity, listings, social).
 */
export const EmergingStanceSchema = z.enum([
  "accumulate",
  "watch",
  "overheated",
  "exit",
  "thesis_failed",
]);
export type EmergingStance = z.infer<typeof EmergingStanceSchema>;

export const EmergingMarketSeedSchema = z.object({
  id: z.string(),
  name: z.string(),
  thesis: z.string(),
  experimentBudgetUsd: z.number(),
  stance: EmergingStanceSchema,
  dataSource: z.literal("manual"),
  hypothesis: z.string(),
});
export type EmergingMarketSeed = z.infer<typeof EmergingMarketSeedSchema>;

export const EMERGING_MARKET_SEEDS: EmergingMarketSeed[] = [
  {
    id: "one-piece",
    name: "One Piece TCG",
    thesis: "Character popularity × rarity × early issue × scarcity. Heroines + OP01 icons, not OP-XX chase.",
    experimentBudgetUsd: 350,
    stance: "watch",
    dataSource: "manual",
    hypothesis: "Can VIP identify which characters/rarities become blue chips while the hierarchy forms?",
  },
  {
    id: "gundam",
    name: "Gundam Card Game",
    thesis: "First/early issue × iconic Mobile Suit × scarcity. 50-year IP, new TCG — we may be early.",
    experimentBudgetUsd: 250,
    stance: "watch",
    dataSource: "manual",
    hypothesis: "Can VIP recognize a new collectible market before it matures?",
  },
  {
    id: "lorcana",
    name: "Disney Lorcana",
    thesis: "Disney cultural importance × early Lorcana history × premium rarity. First Chapter > newer Iconics.",
    experimentBudgetUsd: 150,
    stance: "watch",
    dataSource: "manual",
    hypothesis: "Can VIP find historically significant pieces that get undervalued as collectors chase newer sets?",
  },
  {
    id: "riftbound",
    name: "Riftbound",
    thesis: "Moonshot — League audience not historically card collectors. Learn the market, do not size in.",
    experimentBudgetUsd: 100,
    stance: "watch",
    dataSource: "manual",
    hypothesis: "Digital engagement spillover into physical collecting — unproven.",
  },
  {
    id: "vintage-nonsports",
    name: "Vintage non-sports",
    thesis: "Carddass / Marvel / Nintendo / Star Wars oddities — tiny supply, huge cultural recognition.",
    experimentBudgetUsd: 150,
    stance: "watch",
    dataSource: "manual",
    hypothesis: "Inefficient market where VIP could matter more than in Pokémon.",
  },
];
