import { readFileSync } from "node:fs";
import { z } from "zod";
import { field, unknownField, type CardIdentityFields, type EvidenceOrigin } from "@vip/core-model";

export const SCAN_VISION_RULE = "scan-vision-structured@0.2.0";

export const VisionFieldStatusSchema = z.enum(["observed", "inferred", "unknown"]);

export const VisionFieldSchema = z.object({
  value: z.string().nullable(),
  status: VisionFieldStatusSchema,
  uncertainty: z.number().min(0).max(1).default(1),
  evidence: z.string().nullable().optional(),
});
export type VisionField = z.infer<typeof VisionFieldSchema>;

const emptyVisionField = (): VisionField => ({
  value: null,
  status: "unknown",
  uncertainty: 1,
  evidence: null,
});

const CardFieldsSchema = z.object({
  playerOrCharacter: VisionFieldSchema.default(emptyVisionField()),
  year: VisionFieldSchema.default(emptyVisionField()),
  manufacturer: VisionFieldSchema.default(emptyVisionField()),
  brand: VisionFieldSchema.default(emptyVisionField()),
  productSet: VisionFieldSchema.default(emptyVisionField()),
  cardNumber: VisionFieldSchema.default(emptyVisionField()),
  team: VisionFieldSchema.default(emptyVisionField()),
  rookie: VisionFieldSchema.default(emptyVisionField()),
  insertSubset: VisionFieldSchema.default(emptyVisionField()),
  possibleParallel: VisionFieldSchema.default(emptyVisionField()),
  serialNumber: VisionFieldSchema.default(emptyVisionField()),
  autograph: VisionFieldSchema.default(emptyVisionField()),
  relic: VisionFieldSchema.default(emptyVisionField()),
});

export const VisionExtractSchema = z.object({
  ...CardFieldsSchema.shape,
  notes: z.array(z.string()).default([]),
});
export type VisionExtract = z.infer<typeof VisionExtractSchema>;

export type VisionResult = {
  extract: VisionExtract | null;
  textFront: string;
  textBack: string;
  model: string;
  estimatedCostUsd: number;
  ms: number;
  skipped: string | null;
};

function visionEnabled(): boolean {
  const mode = (process.env.VIP_SCAN_VISION ?? "auto").trim().toLowerCase();
  if (mode === "0" || mode === "off" || mode === "false") return false;
  return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
}

function mimeOf(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function dataUrl(path: string): string {
  const buf = readFileSync(path);
  return `data:${mimeOf(path)};base64,${buf.toString("base64")}`;
}

function observedSummary(extract: VisionExtract | null): string {
  if (!extract) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(extract)) {
    if (k === "notes") continue;
    const f = v as VisionField;
    if (f && f.status === "observed" && f.value) parts.push(`${k} ${f.value}`);
  }
  return parts.join(" ");
}

const SYSTEM = `You identify a trading card from a FRONT photo and a BACK photo sent together.
Return JSON only. Every identity field must be an object:
{ "value": string|null, "status": "observed"|"inferred"|"unknown", "uncertainty": 0..1, "evidence": string|null }

status rules:
- observed: printed text, logo, or marking you can actually see on the front or back.
- inferred: a guess that is not printed. Do not copy inferred values into identity.
- unknown: not visible. value must be null.

Fields: playerOrCharacter, year, manufacturer, brand, productSet, cardNumber, team,
rookie, insertSubset, possibleParallel, serialNumber, autograph, relic, notes[].

Do not use biography or career-stats prose as the player name.
"Houston brought in Tyrod Taylor..." is evidence of team/context, not the player field.
Unknown is valid. Never invent a card number, parallel, or serial that is not printed.
Do not write prose outside JSON.`;

export async function extractVisionEvidence(input: {
  frontPath: string;
  backPath?: string | null;
}): Promise<VisionResult> {
  const t0 = Date.now();
  if (!visionEnabled()) {
    return {
      extract: null,
      textFront: "",
      textBack: "",
      model: "",
      estimatedCostUsd: 0,
      ms: Date.now() - t0,
      skipped: "vision disabled or no provider key",
    };
  }
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return {
      extract: null,
      textFront: "",
      textBack: "",
      model: "",
      estimatedCostUsd: 0,
      ms: Date.now() - t0,
      skipped: "OPENAI_API_KEY missing — Anthropic vision not wired in this slice",
    };
  }
  const model = process.env.VIP_SCAN_VISION_MODEL?.trim() || "gpt-4o-mini";
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: "Image 1 is the card front. Image 2 is the card back. Extract only visible identity fields. Distinguish OBSERVED from INFERRED. Unknown is valid.",
    },
    { type: "image_url", image_url: { url: dataUrl(input.frontPath) } },
  ];
  if (input.backPath) {
    content.push({ type: "image_url", image_url: { url: dataUrl(input.backPath) } });
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`vision provider ${res.status}: ${err.slice(0, 240)}`);
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = body.choices?.[0]?.message?.content ?? "{}";
  const parsed = VisionExtractSchema.safeParse(JSON.parse(raw));
  const extract = parsed.success ? parsed.data : null;
  const inTok = body.usage?.prompt_tokens ?? 0;
  const outTok = body.usage?.completion_tokens ?? 0;
  const estimatedCostUsd = Number((inTok * 0.00000015 + outTok * 0.0000006).toFixed(6));
  const observed = observedSummary(extract);
  return {
    extract,
    textFront: observed,
    textBack: observed,
    model,
    estimatedCostUsd,
    ms: Date.now() - t0,
    skipped: extract ? null : "vision JSON failed schema",
  };
}

/** Observed vision fields only. Inferred stays in debug, never wins identity. */
export function visionObservedFields(
  extract: VisionExtract,
  origin: EvidenceOrigin = "front_vision",
): CardIdentityFields {
  const empty = unknownField(origin);
  const take = (vf: VisionField, notes?: string) => {
    if (vf.status !== "observed" || !vf.value?.trim()) return empty;
    const conf = Number((1 - vf.uncertainty).toFixed(3));
    return field(vf.value.trim(), Math.max(0.45, Math.min(0.88, conf || 0.75)), origin, notes);
  };
  return {
    category: field("sports", 0.5, origin),
    playerOrCharacter: take(extract.playerOrCharacter, extract.playerOrCharacter.evidence ?? undefined),
    year: take(extract.year, extract.year.evidence ?? undefined),
    manufacturer: take(extract.manufacturer, extract.manufacturer.evidence ?? undefined),
    brand: take(extract.brand, extract.brand.evidence ?? undefined),
    setName: take(extract.productSet, extract.productSet.evidence ?? undefined),
    subsetInsert: take(extract.insertSubset, extract.insertSubset.evidence ?? undefined),
    collectorNumber: take(extract.cardNumber, extract.cardNumber.evidence ?? undefined),
    team: take(extract.team, extract.team.evidence ?? undefined),
    rookie: take(extract.rookie, extract.rookie.evidence ?? undefined),
    parallel: take(extract.possibleParallel, extract.possibleParallel.evidence ?? undefined),
    serialNumber: take(extract.serialNumber, extract.serialNumber.evidence ?? undefined),
    autograph: take(extract.autograph, extract.autograph.evidence ?? undefined),
    relic: take(extract.relic, extract.relic.evidence ?? undefined),
  };
}

/**
 * Vision is the identification engine unless privileged OCR already has a
 * complete base (year + brand/mfr + labeled number + title-region player).
 */
export function shouldRunVision(privilegedComplete: boolean): boolean {
  const mode = (process.env.VIP_SCAN_VISION ?? "auto").trim().toLowerCase();
  if (mode === "0" || mode === "off" || mode === "false") return false;
  if (mode === "always" || mode === "1") return true;
  return !privilegedComplete;
}

/** @deprecated use shouldRunVision — kept so callers compile during the cutover. */
export function shouldEscalateToVision(baseConfidence: number, player: string | null): boolean {
  const complete = Boolean(player && baseConfidence >= Number(process.env.VIP_SCAN_MEDIUM_MIN ?? 0.45));
  return shouldRunVision(complete);
}
