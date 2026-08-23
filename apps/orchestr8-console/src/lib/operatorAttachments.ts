/** Operator files attached to a council run. Caps match orchestr8/services/operator_attachments.py. */

export const MAX_ATTACHMENTS = 8;
export const MAX_TEXT_CHARS = 24_000;
export const MAX_TOTAL_CHARS = 80_000;
export const ALLOWED_SUFFIXES = [
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".ts",
  ".tsx",
  ".py",
] as const;

export type OperatorAttachment = {
  name: string;
  text: string;
  source: "upload" | "repo" | "paste";
};

export function allowedName(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_SUFFIXES.some((s) => lower.endsWith(s));
}

export function normalizeAttachment(raw: OperatorAttachment): OperatorAttachment | null {
  const name = raw.name.trim().slice(0, 180) || "untitled.txt";
  const text = raw.text.slice(0, MAX_TEXT_CHARS);
  if (!text.trim()) return null;
  return { name, text, source: raw.source };
}

export function capAttachments(list: OperatorAttachment[]): OperatorAttachment[] {
  const out: OperatorAttachment[] = [];
  let total = 0;
  for (const item of list) {
    const cleaned = normalizeAttachment(item);
    if (!cleaned) continue;
    if (total + cleaned.text.length > MAX_TOTAL_CHARS) {
      const remain = MAX_TOTAL_CHARS - total;
      if (remain < 80) break;
      cleaned.text = cleaned.text.slice(0, remain);
    }
    out.push(cleaned);
    total += cleaned.text.length;
    if (out.length >= MAX_ATTACHMENTS) break;
  }
  return out;
}

export function parseRefPaths(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter((p) => p && !p.startsWith("/") && !p.split("/").includes("..") && allowedName(p))
    .slice(0, 12);
}

export async function readLocalFiles(files: FileList | File[]): Promise<{
  attachments: OperatorAttachment[];
  errors: string[];
}> {
  const errors: string[] = [];
  const attachments: OperatorAttachment[] = [];
  for (const file of Array.from(files)) {
    if (!allowedName(file.name)) {
      errors.push(`${file.name}: use ${ALLOWED_SUFFIXES.join(", ")}`);
      continue;
    }
    const text = await file.text();
    const cleaned = normalizeAttachment({ name: file.name, text, source: "upload" });
    if (!cleaned) {
      errors.push(`${file.name}: empty`);
      continue;
    }
    attachments.push(cleaned);
  }
  return { attachments: capAttachments(attachments), errors };
}
