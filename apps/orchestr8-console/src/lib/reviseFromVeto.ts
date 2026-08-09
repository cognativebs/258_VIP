import type { JobResult, JobStep } from "@/lib/orchestr8Api";

/** Hard stop: one paid revision after a Build Spec veto. */
export const VETO_REVISION_MAX = 1;

export function extractCriticNotes(result: JobResult | null, steps: JobStep[] = []): string {
  if (!result) return "";
  const pool = [...(result.trace || []), ...steps].filter((s) => s.role === "critic" && s.text);
  const last = pool[pool.length - 1];
  const body = (last?.text || result.vote?.summary || result.text || "").trim();
  return body.slice(0, 3500);
}

export function buildVetoRevisionPrompt(args: {
  priorRunId: string;
  originalGoal: string;
  criticNotes: string;
  voteSummary?: string;
}): string {
  const notes = args.criticNotes.trim() || "(no critic text captured — use vote summary)";
  const summary = args.voteSummary?.trim() || "";
  return `## REVISION ROUND 1 of 1 (hard stop after this)
Prior run: ${args.priorRunId} — Critic VETOED. Operator APPROVES the veto catch.
Do NOT expand scope. Close ONLY the Critic conditions below, then append a fenced \`\`\`json build-spec block.
Inside JSON (especially cursor_prompt), never use markdown triple-backtick fences — use ~~~ or indent.

### Vote summary
${summary || "(none)"}

### Critic conditions / findings (must resolve)
${notes}

### Original goal (unchanged intent)
${args.originalGoal.trim() || "(missing — reconstruct from critic notes)"}

### Hard stop
This is the last revision round. Prefer approve or conditional-approve over new research homework.
If a fact cannot be verified from tools, state the assumption in the spec — do not invent blockers that require another council pass.
`;
}

export function isVetoRevisionPrompt(goal: string): boolean {
  return /##\s*REVISION ROUND\s+1\s+of\s+1/i.test(goal);
}
