import { z } from "zod";

/** Operator-saved team from Save team — name becomes the council button. */
export const savedCouncilInputSchema = z.object({
  name: z.string().trim().min(2).max(60),
  purpose: z.string().trim().max(280).optional(),
  agents: z.array(z.string().min(1)).min(1),
  mode: z.enum(["pipeline", "parallel", "single"]),
  voting: z.enum(["none", "veto_on_critical", "dissent_required"]).optional(),
});

export type SavedCouncilInput = z.infer<typeof savedCouncilInputSchema>;
