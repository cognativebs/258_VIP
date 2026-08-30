import { readFileSync } from "node:fs";
import { z } from "zod";

export const SCAN_VISION_RULE = "scan-vision-structured@0.1.0";

const ObservedField = z.object({
  value: z.string().nullable(),
  observed: z.boolean(),
});

const SideSchema = z.object({
  playerOrCharacter: ObservedField.optional(),
  year: ObservedField.optional(),
  manufacturer: ObservedField.optional(),
  brand: ObservedField.optional(),
  setName: ObservedField.optional(),
  collectorNumber: ObservedField.optional(),
  team: ObservedField.optional(),
  parallel: ObservedField.optional(),
  serialNumber: ObservedField.optional(),
  autograph: ObservedField.optional(),
  relic: ObservedField.optional(),
  rookie: ObservedField.optional(),
});

export const VisionExtractSchema = z.object({
  front: SideSchema,
  back: SideSchema,
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

function observedText(side: z.infer<typeof SideSchema> | undefined): string {
  if (!side) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(side)) {
    if (v && v.observed && v.value) parts.push(`${k} ${v.value}`);
  }
  return parts.join(" ");
}

const SYSTEM = `You identify trading cards from a front photo and a back photo.
Return JSON only matching the schema.
Use observed:true only for text or markings you can actually see.
Use observed:false and value:null when not visible.
Never invent a card number, parallel, or serial that is not printed.
Do not write prose.`;

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
      text: "Front image first, back image second. Extract only visible identity fields.",
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
  // gpt-4o-mini ballpark; telemetry is an estimate, not an invoice.
  const estimatedCostUsd = Number((inTok * 0.00000015 + outTok * 0.0000006).toFixed(6));
  return {
    extract,
    textFront: observedText(extract?.front),
    textBack: observedText(extract?.back),
    model,
    estimatedCostUsd,
    ms: Date.now() - t0,
    skipped: extract ? null : "vision JSON failed schema",
  };
}

export function shouldEscalateToVision(baseConfidence: number, player: string | null): boolean {
  const mode = (process.env.VIP_SCAN_VISION ?? "auto").trim().toLowerCase();
  if (mode === "0" || mode === "off" || mode === "false") return false;
  if (mode === "always" || mode === "1") return true;
  const min = Number(process.env.VIP_SCAN_MEDIUM_MIN ?? 0.45);
  return baseConfidence < min || !player;
}
