import { z } from "zod";
import { ProvenanceSchema, type Provenance } from "./provenance.js";

/**
 * Binder Vault records provenance in its own shape (vault_tcg.binder_slot
 * provenance_* columns). This maps it onto the shared contract wherever a
 * Binder value leaves Binder — the Binder app and the VIP write path both use
 * it, so there is one mapping (owner approved 2026-11-22, finish plan Q6).
 *
 * Nothing is invented: a missing version is `binder-vault:unversioned`, a
 * missing confidence is 0 with band low and a note, and a missing method is
 * `inferred` (never presented as observed).
 */
export const BINDER_UNVERSIONED = "binder-vault:unversioned";

export const BinderProvenanceInputSchema = z.object({
  method: z.string().nullable(),
  source: z.string().nullable(),
  modelVersion: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  verificationStatus: z.string().nullable(),
});
export type BinderProvenanceInput = z.infer<typeof BinderProvenanceInputSchema>;

const OBSERVED_METHODS = new Set(["api", "user_upload"]);

export function fromBinderProvenance(input: BinderProvenanceInput): Provenance {
  const p = BinderProvenanceInputSchema.parse(input);
  const method = (p.method ?? "").trim().toLowerCase();
  const notes: string[] = [];
  if (method === "user_upload") notes.push("binder method user_upload");
  if (!method) notes.push("method not recorded by Binder");
  else if (method !== "inferred" && !OBSERVED_METHODS.has(method)) notes.push(`binder method ${method}`);
  if (p.confidence == null) notes.push("confidence not recorded by Binder");

  return ProvenanceSchema.parse({
    source: p.source?.trim() || "binder-vault",
    method: OBSERVED_METHODS.has(method) ? "observed" : "inferred",
    ruleOrModelVersion: p.modelVersion?.trim() || BINDER_UNVERSIONED,
    confidence: p.confidence ?? 0,
    ...(p.confidence == null ? { confidenceBand: "low" as const } : {}),
    verificationStatus: (p.verificationStatus ?? "").trim().toLowerCase() === "verified" ? "verified" : "unverified",
    ...(notes.length ? { notes: notes.join("; ") } : {}),
  });
}
