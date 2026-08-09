import { z } from "zod";
import type { ApiHolding } from "../holdings.js";

export const CompSaleSchema = z.object({
  id: z.string(),
  price: z.number().nonnegative(),
  saleDate: z.coerce.date(),
  source: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
  provenance: z.object({
    method: z.enum(["observed", "api"]),
    ruleOrModelVersion: z.string(),
    verificationStatus: z.enum(["verified", "unverified"]),
    confidence: z.number().min(0).max(1),
    notes: z.string().optional(),
  }),
});
export type CompSale = z.infer<typeof CompSaleSchema>;

export type CompsAdapterResult = {
  adapterId: string;
  sales: CompSale[];
  /** Why zero sales when empty — never silent. */
  emptyReason?: string;
};

export type CompsAdapter = {
  id: string;
  label: string;
  /** Which holdings this adapter answers for. */
  matches: (holding: ApiHolding) => boolean;
  fetchComps: (holding: ApiHolding) => Promise<CompsAdapterResult>;
};
