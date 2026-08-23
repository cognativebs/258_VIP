import type { JobResult, JobStep } from "./orchestr8Api";
import { extractCriticNotes } from "./reviseFromVeto";

export type ChatKind = "user" | "progress" | "role" | "question" | "final";

export type CouncilChatMessage = {
  id: string;
  kind: ChatKind;
  title: string;
  preview: string;
  body: string;
  meta?: string;
};

function previewOf(text: string, n = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

export function extractCouncilQuestions(result: JobResult | null, steps: JobStep[]): string[] {
  const critic = extractCriticNotes(result, steps);
  const vote = result?.vote?.summary || "";
  const pool = `${critic}\n${vote}`;
  const found = pool
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 8 && line.includes("?"));
  return [...new Set(found)].slice(0, 8);
}

export function buildCouncilTranscript(args: {
  question: string;
  attachmentNames?: string[];
  progressMessage?: string | null;
  loading?: boolean;
  steps: JobStep[];
  result: JobResult | null;
  error?: string | null;
}): CouncilChatMessage[] {
  const messages: CouncilChatMessage[] = [];
  const names = args.attachmentNames?.length
    ? `Attachments: ${args.attachmentNames.join(", ")}`
    : "";
  if (args.question.trim()) {
    messages.push({
      id: "user-goal",
      kind: "user",
      title: "You",
      preview: previewOf(args.question),
      body: [args.question.trim(), names].filter(Boolean).join("\n\n"),
    });
  }
  if (args.loading && args.progressMessage) {
    messages.push({
      id: "progress",
      kind: "progress",
      title: "Council",
      preview: args.progressMessage,
      body: args.progressMessage,
    });
  }
  args.steps.forEach((step, i) => {
    const body = (step.error || step.text || "").trim() || "(no text)";
    messages.push({
      id: `step-${i}-${step.role || "role"}`,
      kind: "role",
      title: step.role_label || step.role || "Role",
      preview: previewOf(body),
      body,
      meta: [step.model_label || step.model, step.verdict, step.error ? "error" : ""]
        .filter(Boolean)
        .join(" · "),
    });
  });
  const questions = extractCouncilQuestions(args.result, args.steps);
  questions.forEach((q, i) => {
    messages.push({
      id: `q-${i}`,
      kind: "question",
      title: "Council question",
      preview: previewOf(q),
      body: q,
    });
  });
  if (args.error) {
    messages.push({
      id: "error",
      kind: "final",
      title: "Error",
      preview: previewOf(args.error),
      body: args.error,
    });
  }
  if (args.result?.text) {
    messages.push({
      id: "final",
      kind: "final",
      title: args.result.vote?.vetoed ? "Vetoed" : "Final",
      preview: previewOf(args.result.text),
      body: args.result.text,
      meta: args.result.vote?.summary,
    });
  }
  return messages;
}

export function specCopyPayload(data: {
  markdown?: string | null;
  spec?: Record<string, unknown> | null;
}): { markdown: string; json: string; cursorPrompt: string } {
  const spec = data.spec || {};
  const cursorPrompt = typeof spec.cursor_prompt === "string" ? spec.cursor_prompt : "";
  return {
    markdown: data.markdown || "",
    json: Object.keys(spec).length ? JSON.stringify(spec, null, 2) : "",
    cursorPrompt,
  };
}
