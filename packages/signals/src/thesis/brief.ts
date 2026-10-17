/**
 * Daily SIGNALS brief → Orchestr8 → Thesis (operator decisions 2026-10-17).
 *
 * The brief job hands Orchestr8 the last day's signals plus the open theses; the
 * council answers with a collector-facing summary and a fenced JSON block. This
 * module owns that contract (pure): the question, the lenient parse of the model's
 * JSON, and the gate every thesis passes before it is stored.
 *
 * Gate rules: a thesis must cite at least one signal that was in the brief (no
 * thesis without evidence); Buy, Sell and Grade become Watch with the proposed
 * action withheld while market data is absent (spec 31, same as proposals);
 * confidence is capped at 0.75 because the evidence is news, not sales. Orchestr8's
 * verdicts on existing theses are advisory and never change a thesis's status.
 */
import { z } from "zod";
import { ProposalActionSchema, type ProposalAction } from "../synthesis/proposal.js";

export const BRIEF_VERSION = "signals-brief@0.1.0";
export const BRIEF_TASK = "signals_brief";
/** Pipeline order: hunt the signals, frame theses, challenge them, write the brief. */
export const BRIEF_ROLES = ["signal_hunter", "thesis_manager", "critic", "synthesizer"] as const;
/** News-derived theses never claim more than this (no fake precision). */
export const THESIS_CONFIDENCE_CAP = 0.75;
const NEEDS_MARKET = "needs sold comps (market data) first";
const MARKET_ACTIONS = new Set<ProposalAction>(["Buy", "Sell", "Grade"]);

export const BriefSignalSchema = z
  .object({
    /** Short citation handle ("S3"): models copy these reliably, UUIDs they truncate. */
    ref: z.string().regex(/^S\d+$/),
    signalId: z.string().uuid(),
    group: z.string().min(1),
    domain: z.string().min(1),
    title: z.string().min(1),
    summary: z.string(),
    type: z.string().min(1),
    direction: z.string().min(1),
    band: z.string().nullable(),
    attribution: z.string().min(1),
    url: z.string().nullable(),
    firstSeenAt: z.string(),
    confidence: z.number().min(0).max(1),
    method: z.string().min(1),
    proposal: z.string().nullable(),
    exposure: z.string().nullable(),
  })
  .strict();
export type BriefSignal = z.infer<typeof BriefSignalSchema>;

export const OpenThesisSchema = z
  .object({
    id: z.string().uuid(),
    claim: z.string().min(1),
    action: ProposalActionSchema,
    status: z.enum(["draft", "active"]),
    horizonDays: z.number().int().positive(),
    createdAt: z.string(),
  })
  .strict();
export type OpenThesis = z.infer<typeof OpenThesisSchema>;

const actionFrom = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const t = v.trim().toLowerCase();
  return ProposalActionSchema.options.find((a) => a.toLowerCase() === t) ?? v;
}, ProposalActionSchema);

/** Models answer 0.6 or 60; both mean 60%. */
const confidenceFrom = z.preprocess((v) => {
  const n = typeof v === "string" ? Number(v.replace("%", "")) : v;
  return typeof n === "number" && n > 1 && n <= 100 ? n / 100 : n;
}, z.number().min(0).max(1));

/** Citations arrive as signal_refs ("S3") or signal_ids (full or prefix); both land in signal_ids. */
export const BriefThesisCandidateSchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    const cited = [o.signal_refs, o.signal_ids].flatMap((x) => (Array.isArray(x) ? x : typeof x === "string" ? [x] : []));
    return { ...o, signal_ids: cited.map(String) };
  },
  z.object({
    claim: z.string().trim().min(8).max(600),
    horizon_days: z.coerce.number().int().min(1).max(730),
    action: actionFrom,
    confidence: confidenceFrom,
    reasons: z.array(z.string().trim().min(1)).min(1).max(8),
    signal_ids: z.array(z.string()).min(1),
    domain: z.string().trim().min(1).optional(),
    subjects: z.array(z.string().trim().min(1)).max(10).optional(),
  }),
);
export type BriefThesisCandidate = z.infer<typeof BriefThesisCandidateSchema>;

export const ThesisVerdictSchema = z.object({
  thesis_id: z.string().uuid(),
  verdict: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(["holds", "weakened", "invalidated"])),
  reason: z.string().trim().min(1).max(600),
});
export type ThesisVerdict = z.infer<typeof ThesisVerdictSchema>;

export type BriefOutput = {
  headline: string;
  summary: string;
  sections: { group: string; points: string[] }[];
  theses: BriefThesisCandidate[];
  thesisUpdates: ThesisVerdict[];
  /** Items the model returned that failed their schema — reported, never stored. */
  rejected: { kind: "thesis" | "thesis_update"; issue: string }[];
};

const SectionSchema = z.object({ group: z.string().min(1), points: z.array(z.string().min(1)).max(12) });

/**
 * Lenient: a malformed thesis drops that thesis, not the brief. Returns null only
 * when there is no JSON object with a summary at all.
 */
export function parseBriefOutput(structured: unknown, prose = ""): BriefOutput | null {
  if (!structured || typeof structured !== "object") return null;
  const o = structured as Record<string, unknown>;
  const summary = typeof o.summary === "string" && o.summary.trim() ? o.summary.trim() : prose.trim();
  if (!summary) return null;
  const rejected: BriefOutput["rejected"] = [];
  const theses: BriefThesisCandidate[] = [];
  for (const t of Array.isArray(o.theses) ? o.theses : []) {
    const p = BriefThesisCandidateSchema.safeParse(t);
    if (p.success) theses.push(p.data);
    else rejected.push({ kind: "thesis", issue: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  const thesisUpdates: ThesisVerdict[] = [];
  for (const u of Array.isArray(o.thesis_updates) ? o.thesis_updates : []) {
    const p = ThesisVerdictSchema.safeParse(u);
    if (p.success) thesisUpdates.push(p.data);
    else rejected.push({ kind: "thesis_update", issue: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  const sections = (Array.isArray(o.sections) ? o.sections : []).flatMap((s) => {
    const p = SectionSchema.safeParse(s);
    return p.success ? [p.data] : [];
  });
  return {
    headline: typeof o.headline === "string" && o.headline.trim() ? o.headline.trim().slice(0, 200) : summary.split(/[.\n]/)[0]!.slice(0, 200),
    summary,
    sections,
    theses,
    thesisUpdates,
    rejected,
  };
}

/** Lowercase letters and digits only, so the same claim reworded in case or punctuation matches. */
export function claimKey(claim: string): string {
  return claim
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const ThesisDraftSchema = z
  .object({
    claim: z.string().min(1).max(600),
    claimKey: z.string().min(1),
    domain: z.string().min(1),
    subjectRefs: z.array(z.string()),
    horizonDays: z.number().int().min(1).max(730),
    action: ProposalActionSchema,
    withheld: z.array(z.object({ action: ProposalActionSchema, reason: z.string().min(1) }).strict()),
    confidence: z.number().min(0).max(THESIS_CONFIDENCE_CAP),
    reasons: z.array(z.string().min(1)).min(1),
    signalIds: z.array(z.string().uuid()).min(1),
  })
  .strict();
export type ThesisDraft = z.infer<typeof ThesisDraftSchema>;

export type GateResult = { ok: true; draft: ThesisDraft } | { ok: false; reason: string };

/** Every stored thesis passes here first. */
/** A ref ("S3"), a full id, or a unique id prefix of 8+ characters; anything else resolves to nothing. */
export function resolveCitation(token: string, briefSignals: ReadonlyArray<Pick<BriefSignal, "signalId"> & { ref?: string }>): string | null {
  const t = token.trim().replace(/^\[|\]$/g, "").toLowerCase();
  const byRef = briefSignals.find((s) => s.ref?.toLowerCase() === t);
  if (byRef) return byRef.signalId.toLowerCase();
  const exact = briefSignals.find((s) => s.signalId.toLowerCase() === t);
  if (exact) return exact.signalId.toLowerCase();
  if (t.length < 8 || !/^[0-9a-f-]+$/.test(t)) return null;
  const prefixed = briefSignals.filter((s) => s.signalId.toLowerCase().startsWith(t));
  return prefixed.length === 1 ? prefixed[0]!.signalId.toLowerCase() : null;
}

export function gateThesis(
  c: BriefThesisCandidate,
  briefSignals: ReadonlyArray<Pick<BriefSignal, "signalId" | "domain"> & { ref?: string }>,
  opts: { marketData?: boolean } = {},
): GateResult {
  const byId = new Map(briefSignals.map((s) => [s.signalId.toLowerCase(), s]));
  const cited = [...new Set(c.signal_ids.map((token) => resolveCitation(token, briefSignals)).filter((id): id is string => id !== null))];
  if (!cited.length) return { ok: false, reason: `"${c.claim.slice(0, 60)}" cites no signal from this brief` };

  let action = c.action;
  const withheld: ThesisDraft["withheld"] = [];
  const reasons = [...c.reasons];
  if (MARKET_ACTIONS.has(action) && !opts.marketData) {
    withheld.push({ action, reason: `Orchestr8 proposed ${action}; ${NEEDS_MARKET}` });
    action = "Watch";
  }
  let confidence = Math.round(c.confidence * 1000) / 1000;
  if (confidence > THESIS_CONFIDENCE_CAP) {
    reasons.push(`Confidence capped at ${THESIS_CONFIDENCE_CAP} (news evidence, not sales)`);
    confidence = THESIS_CONFIDENCE_CAP;
  }
  const domains = cited.map((id) => byId.get(id)!.domain);
  const domain =
    c.domain && domains.includes(c.domain)
      ? c.domain
      : [...new Set(domains)].sort((a, b) => domains.filter((d) => d === b).length - domains.filter((d) => d === a).length)[0]!;

  return {
    ok: true,
    draft: ThesisDraftSchema.parse({
      claim: c.claim,
      claimKey: claimKey(c.claim),
      domain,
      subjectRefs: c.subjects ?? [],
      horizonDays: c.horizon_days,
      action,
      withheld,
      confidence,
      reasons,
      signalIds: cited,
    }),
  };
}

const JSON_SHAPE = `{
  "headline": "one line, under 120 characters",
  "summary": "the brief in plain English, 120-250 words: what changed, why it matters to this collector, what to do",
  "confidence": 0.0-1.0,
  "sections": [{"group": "Pokémon | Sports | Collectibles | Headlines | Markets", "points": ["short point citing the signal title"]}],
  "theses": [{
    "claim": "a falsifiable belief, e.g. 'Delta Reign sealed will sell out at MSRP within 30 days'",
    "horizon_days": 30,
    "action": "Buy | Hold | Grade | Sell | Lot | Pass | Watch",
    "confidence": 0.0-0.75,
    "reasons": ["why, citing signals"],
    "signal_refs": ["S1", "S4"],
    "domain": "collectibles | sports_cards | macro",
    "subjects": ["set, card, player or product names"]
  }],
  "thesis_updates": [{"thesis_id": "id from openTheses", "verdict": "holds | weakened | invalidated", "reason": "which signal changed it"}]
}`;

/** The question the brief council starts from. Context JSON carries the signals and open theses. */
export function briefQuestion(opts: { windowHours: number; signalCount: number; openTheses: number; now: Date }): string {
  return [
    `Daily SIGNALS brief for a collector (Pokémon, sports cards, comics) as of ${opts.now.toISOString()}.`,
    `The context JSON holds ${opts.signalCount} signal(s) from the last ${opts.windowHours} hours ("signals", each with a short ref such as S1, a source attribution and a link) and ${opts.openTheses} open thesis/theses ("openTheses").`,
    "Signal Hunter: pick what matters and what is noise. Thesis Manager: propose at most 5 new theses (only where signals support one) and judge each open thesis: holds, weakened or invalidated. Critic: challenge weak or unsupported theses and remove them. Synthesizer: write the final brief.",
    "Rules: every thesis cites the refs (S1, S2, …) of the signals it rests on in signal_refs; refs appear only in signal_refs, never in the summary, sections or reasons, which name signals by title; news is never a price; Buy, Sell or Grade only with market evidence (there is none in this context, so prefer Watch or Hold and say what would need confirming); confidence never above 0.75; say 'unverified' where it applies; do not invent signals, prices or facts.",
    `End the final answer with one fenced json block in exactly this shape:\n${JSON_SHAPE}`,
  ].join("\n\n");
}
