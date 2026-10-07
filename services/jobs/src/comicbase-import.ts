/**
 * ComicBase watched-folder import (ADR 0016) — runs scripts/import_comicbase.py, which owns
 * snapshot → parse → match → review list. Each new export in VIP_COMICBASE_INBOX is imported
 * once; a file with the same bytes is skipped. Python stays the ingest language (ADR 0006).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "import_comicbase.py");

export type ComicbaseImportResult = { exitCode: number; reports: Record<string, unknown>[]; stderr: string };

export function runComicbaseImport(opts: { python?: string; extraArgs?: string[] } = {}): Promise<ComicbaseImportResult> {
  if (!existsSync(SCRIPT)) return Promise.reject(new Error(`Missing ${SCRIPT}`));
  const bin = opts.python ?? process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [SCRIPT, ...(opts.extraArgs ?? [])], { cwd: REPO_ROOT, env: process.env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      const reports = out
        .split(/\r?\n/)
        .filter((l) => l.startsWith("{"))
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      resolve({ exitCode: code ?? 1, reports, stderr: err.trim() });
    });
  });
}

export function formatComicbaseImport(r: ComicbaseImportResult): string {
  if (r.exitCode !== 0) return `VIP Job — comicbase-import failed (exit ${r.exitCode}): ${r.stderr.split("\n").slice(-3).join(" ")}`;
  const lines = r.reports.map((p) => {
    if (p.files === 0) return `no ComicBase export in ${String(p.inbox)}`;
    if (p.skipped) return `${String(p.file)}: ${String(p.skipped)}`;
    const res = (p.result ?? p.would ?? {}) as Record<string, number>;
    return `${String(p.file)}: ${p.items} items · matched ${res.matched ?? 0} · to review ${res.needs_review ?? 0} · unmatched ${res.unmatched ?? 0}`;
  });
  return ["VIP Job — comicbase-import", ...lines].join("\n");
}
