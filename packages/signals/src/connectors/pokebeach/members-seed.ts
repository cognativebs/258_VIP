/**
 * Tracked PokéBeach members (operator list, 2026-10-03). Configuration rows in
 * vault_core.signals_source_author, not business logic; migration 20261003_01
 * seeds exactly this list and a test fails if they drift. Weights are per
 * specialty, never one credibility number. Water Pokémon Master and The-Kaiser
 * carry the operator's weights; the rest start at 0.5 everywhere · unverified.
 * Profile URLs stay null until the operator supplies them (forum pages are not
 * searched or crawled to find them).
 */
import { z } from "zod";

const Weight = z.number().min(0).max(1);
export const MemberWeightsSchema = z
  .object({ news: Weight, sealed: Weight, collecting: Weight, competitive: Weight, market: Weight })
  .strict();
export type MemberWeights = z.infer<typeof MemberWeightsSchema>;

export const TrackedMemberSchema = z
  .object({
    handle: z.string().min(1).max(80),
    weights: MemberWeightsSchema,
    weightsFrom: z.enum(["operator", "default"]),
  })
  .strict();
export type TrackedMember = z.infer<typeof TrackedMemberSchema>;

const DEFAULT: MemberWeights = { news: 0.5, sealed: 0.5, collecting: 0.5, competitive: 0.5, market: 0.5 };

export const POKEBEACH_TRACKED_MEMBERS_SEED: TrackedMember[] = [
  { handle: "Water Pokémon Master", weightsFrom: "operator", weights: { news: 1.0, sealed: 0.7, collecting: 0.8, competitive: 0.8, market: 0.8 } },
  { handle: "The-Kaiser", weightsFrom: "operator", weights: { news: 0.4, sealed: 1.0, collecting: 0.9, competitive: 0.3, market: 0.8 } },
  { handle: "oklandon", weightsFrom: "default", weights: DEFAULT },
  { handle: "PMJ", weightsFrom: "default", weights: DEFAULT },
  { handle: "Travinking0927", weightsFrom: "default", weights: DEFAULT },
  { handle: "ztnoob", weightsFrom: "default", weights: DEFAULT },
  { handle: "NovaAcerola", weightsFrom: "default", weights: DEFAULT },
  { handle: "Hollow Foil", weightsFrom: "default", weights: DEFAULT },
];
