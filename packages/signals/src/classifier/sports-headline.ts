/**
 * Sports headline classifier (pure). Hybrid: a keyword pre-filter drops
 * rankings/betting/fantasy noise, then an LLM (behind LlmClassificationSchema)
 * or the keyword rules decide the signal type. No network here; the caller
 * makes the LLM call. Every number comes from the rule set, a data row in
 * vault_core.signals_classifier_rule_set, never from a constant in code.
 */
import { z } from "zod";
import { SpineSignalTypeCodeSchema, type SpineSignalTypeCode } from "../schemas/spine.js";

export const SPORTS_HEADLINE_CLASSIFIER = "sports-headline";

const Unit = z.number().min(0).max(1);
const RegexSource = z.string().min(1).refine((src) => {
  try {
    new RegExp(src, "i");
    return true;
  } catch {
    return false;
  }
}, "invalid regular expression");

export const InjurySeveritySchema = z.enum(["day", "weeks", "season", "unknown"]);
export type InjurySeverity = z.infer<typeof InjurySeveritySchema>;

export const SignalDirectionSchema = z.enum(["up", "down", "mixed"]);

export const ClassifierRuleSetSchema = z
  .object({
    schema: z.literal("vip_signals_classifier_rules_v1"),
    classifier: z.literal(SPORTS_HEADLINE_CLASSIFIER),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    domain: z.literal("sports_cards"),
    scoring: z
      .object({
        /** Multiplies confidence when the headline is hedged ("sources", "expected to"). */
        hedgeFactor: Unit,
        /** noise_probability for a claim only one independent source carries. */
        singleSourceNoise: Unit,
        /** Classifier confidence assigned to a keyword-rule match. */
        rulesConfidence: Unit,
      })
      .strict(),
    noisePatterns: z.array(RegexSource),
    hedgePatterns: z.array(RegexSource),
    /** Evaluated in order; the first rule whose pattern matches the title and whose exclusions do not wins. */
    rules: z.array(
      z
        .object({
          type: SpineSignalTypeCodeSchema,
          patterns: z.array(RegexSource).min(1),
          excludePatterns: z.array(RegexSource),
        })
        .strict(),
    ),
    injurySeverity: z
      .object({ season: z.array(RegexSource), weeks: z.array(RegexSource), day: z.array(RegexSource) })
      .strict(),
    types: z.record(
      SpineSignalTypeCodeSchema,
      z
        .object({
          direction: SignalDirectionSchema,
          impact: z
            .object({ unknown: Unit, day: Unit.optional(), weeks: Unit.optional(), season: Unit.optional() })
            .strict(),
        })
        .strict(),
    ),
    notes: z.string().min(1),
  })
  .strict()
  .superRefine((rs, ctx) => {
    rs.rules.forEach((rule, i) => {
      if (!rs.types[rule.type]) {
        ctx.addIssue({ code: "custom", path: ["rules", i, "type"], message: `no scoring entry for ${rule.type}` });
      }
    });
  });
export type ClassifierRuleSet = z.infer<typeof ClassifierRuleSetSchema>;

export const SubjectKindSchema = z.enum(["player", "coach", "executive", "team", "league", "other", "unknown"]);

/** What the LLM must return. Anything else is discarded, and the rules decide. */
export const LlmClassificationSchema = z
  .object({
    signalType: z.union([SpineSignalTypeCodeSchema, z.literal("NONE")]),
    subjectKind: SubjectKindSchema,
    subjectName: z.string().min(1).max(120).nullable(),
    severity: InjurySeveritySchema.nullable(),
    hedged: z.boolean(),
    confidence: Unit,
    rationale: z.string().max(300),
  })
  .strict();
export type LlmClassification = z.infer<typeof LlmClassificationSchema>;

export type Headline = { title: string; description: string | null };

export type SignalDecision = {
  outcome: "signal";
  method: "rules" | "llm";
  signalType: SpineSignalTypeCode;
  subjectName: string | null;
  severity: InjurySeverity | null;
  hedged: boolean;
  classifierConfidence: number;
  evidence: string;
};

export type HeadlineDecision =
  | { outcome: "noise"; matched: string }
  | { outcome: "no_signal"; method: "rules" | "llm"; reason: string }
  | SignalDecision;

export type CompiledRuleSet = {
  ruleSet: ClassifierRuleSet;
  noise: RegExp[];
  hedge: RegExp[];
  rules: { type: SpineSignalTypeCode; patterns: RegExp[]; exclude: RegExp[] }[];
  severity: { season: RegExp[]; weeks: RegExp[]; day: RegExp[] };
};

const rx = (sources: string[]) => sources.map((s) => new RegExp(s, "i"));

export function compileRuleSet(raw: unknown): CompiledRuleSet {
  const ruleSet = ClassifierRuleSetSchema.parse(raw);
  return {
    ruleSet,
    noise: rx(ruleSet.noisePatterns),
    hedge: rx(ruleSet.hedgePatterns),
    rules: ruleSet.rules.map((r) => ({ type: r.type, patterns: rx(r.patterns), exclude: rx(r.excludePatterns) })),
    severity: {
      season: rx(ruleSet.injurySeverity.season),
      weeks: rx(ruleSet.injurySeverity.weeks),
      day: rx(ruleSet.injurySeverity.day),
    },
  };
}

const firstMatch = (patterns: RegExp[], text: string) => patterns.find((p) => p.test(text)) ?? null;
const fullText = (h: Headline) => `${h.title}\n${h.description ?? ""}`;

/** Title only: rankings, betting, fantasy and previews never become signals. */
export function noiseMatch(headline: Headline, c: CompiledRuleSet): string | null {
  return firstMatch(c.noise, headline.title)?.source ?? null;
}

/** Title first: summaries carry negations ("not season-ending") that keywords misread. */
export function injurySeverity(headline: Headline, c: CompiledRuleSet): InjurySeverity {
  for (const text of [headline.title, headline.description ?? ""]) {
    if (firstMatch(c.severity.season, text)) return "season";
    if (firstMatch(c.severity.weeks, text)) return "weeks";
    if (firstMatch(c.severity.day, text)) return "day";
  }
  return "unknown";
}

export function decideByRules(headline: Headline, c: CompiledRuleSet): HeadlineDecision {
  const noise = noiseMatch(headline, c);
  if (noise) return { outcome: "noise", matched: noise };
  for (const rule of c.rules) {
    const hit = firstMatch(rule.patterns, headline.title);
    if (!hit || firstMatch(rule.exclude, headline.title)) continue;
    return {
      outcome: "signal",
      method: "rules",
      signalType: rule.type,
      // Keyword rules cannot tell a player from a coach or extract a name.
      subjectName: null,
      severity: rule.type === "PLAYER_INJURY" ? injurySeverity(headline, c) : null,
      hedged: firstMatch(c.hedge, fullText(headline)) != null,
      classifierConfidence: c.ruleSet.scoring.rulesConfidence,
      evidence: `rule ${rule.type} /${hit.source}/`,
    };
  }
  return { outcome: "no_signal", method: "rules", reason: "no rule matched" };
}

/** The LLM decides type and subject; only players become signals. Noise is filtered before any call. */
export function decideByLlm(headline: Headline, c: CompiledRuleSet, llm: LlmClassification): HeadlineDecision {
  const noise = noiseMatch(headline, c);
  if (noise) return { outcome: "noise", matched: noise };
  if (llm.signalType === "NONE") return { outcome: "no_signal", method: "llm", reason: llm.rationale || "NONE" };
  if (llm.subjectKind !== "player") {
    return { outcome: "no_signal", method: "llm", reason: `subject is ${llm.subjectKind}, not a player` };
  }
  if (!c.ruleSet.types[llm.signalType]) {
    return { outcome: "no_signal", method: "llm", reason: `${llm.signalType} has no scoring entry` };
  }
  return {
    outcome: "signal",
    method: "llm",
    signalType: llm.signalType,
    subjectName: llm.subjectName,
    severity: llm.signalType === "PLAYER_INJURY" ? (llm.severity ?? "unknown") : null,
    hedged: llm.hedged,
    classifierConfidence: llm.confidence,
    evidence: llm.rationale,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The three stored scores. confidenceCeiling is the source row's
 * seed_confidence_ceiling; corroboration is not counted here (one source).
 */
export function scoreDecision(d: SignalDecision, ruleSet: ClassifierRuleSet, confidenceCeiling: number) {
  const entry = ruleSet.types[d.signalType]!;
  const impact =
    d.severity && d.severity !== "unknown" ? (entry.impact[d.severity] ?? entry.impact.unknown) : entry.impact.unknown;
  return {
    baseConfidence: round3(confidenceCeiling * (d.hedged ? ruleSet.scoring.hedgeFactor : 1) * d.classifierConfidence),
    baseImpact: round3(impact),
    noiseProbability: round3(ruleSet.scoring.singleSourceNoise),
    direction: entry.direction,
  };
}

export function llmMessages(headline: Headline, ruleSet: ClassifierRuleSet) {
  const types = Object.keys(ruleSet.types).join(", ");
  return {
    system: [
      "You classify one sports news headline for a sports-card collector.",
      `signalType is one of: ${types}, or NONE when the headline is not a concrete event about one athlete.`,
      "subjectKind says who the event is about. Coaches, executives, owners, analysts and family members are not players.",
      "subjectName is the athlete's name exactly as written, or null.",
      "severity is only for PLAYER_INJURY: day, weeks, season or unknown; otherwise null.",
      "hedged is true when the claim is reported or expected rather than confirmed.",
      "confidence is how sure you are of signalType, 0 to 1. Do not guess facts that are not in the text.",
      "Reply with one JSON object with exactly these keys: signalType, subjectKind, subjectName, severity, hedged, confidence, rationale.",
    ].join("\n"),
    user: `Headline: ${headline.title}\nSummary: ${headline.description ?? "(none)"}`,
  };
}
