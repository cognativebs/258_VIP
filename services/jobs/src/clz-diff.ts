/**
 * Nightly CLZ DIFF watch — report only. Never applies.
 * Confirmation required before `python scripts/clz_diff.py --apply`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "clz_diff.py");

export type ClzDiffJobResult = {
  job: string;
  ranAt: string;
  watch: string;
  empty: boolean;
  reason?: string;
  phase2Enabled: false;
  report?: {
    dryRun: boolean;
    applied: boolean;
    newCount: number;
    changedCount: number;
    unchangedCount: number;
    disappearedCount: number;
    possiblySoldFlagged: number;
    byType?: {
      ownershipNew: number;
      ownershipSold: number;
      ownershipQuantity: number;
      conditionGrade: number;
      clzValueDrift: number;
      metadataOnly: number;
    };
    newNeedFreshVendorMap?: number;
    snapshotPath: string | null;
    reportPath?: string;
    exportPath?: string;
  };
  triggeredBy?: string;
};

function pythonBin(): string {
  if (process.env.PYTHON) return process.env.PYTHON;
  return process.platform === "win32" ? "python" : "python3";
}

export function formatClzDiffReport(result: ClzDiffJobResult): string {
  const r = result.report;
  if (result.empty) {
    return `[clz-diff] watch=${result.watch} empty=true apply=waiting`;
  }
  return [
    `[clz-diff] watch=${result.watch} dryRun=${r?.dryRun ?? true} applied=${r?.applied ?? false}`,
    `  ownership new=${r?.byType?.ownershipNew ?? r?.newCount ?? 0} sold=${r?.byType?.ownershipSold ?? r?.disappearedCount ?? 0} qty=${r?.byType?.ownershipQuantity ?? 0}`,
    `  condition/grade=${r?.byType?.conditionGrade ?? 0} clzValueDrift=${r?.byType?.clzValueDrift ?? 0} metadataOnly=${r?.byType?.metadataOnly ?? 0}`,
    `  newNeedFreshVendorMap=${r?.newNeedFreshVendorMap ?? 0} unchanged=${r?.unchangedCount ?? 0}`,
    `  snapshot=${r?.snapshotPath ?? "none"} report=${r?.reportPath ?? "none"}`,
    "  waiting for confirmation before --apply",
  ].join("\n");
}

function parseStdout(stdout: string): ClzDiffJobResult {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith("{"));
  if (!jsonLine) {
    throw new Error("clz_diff.py produced no JSON result");
  }
  const parsed = JSON.parse(jsonLine) as ClzDiffJobResult;
  if (!parsed || parsed.job !== "clz-diff") {
    throw new Error("clz_diff.py did not return a clz-diff JSON result");
  }
  return parsed;
}

export function runClzDiffJob(opts?: { triggeredBy?: string; extraArgs?: string[] }): ClzDiffJobResult {
  if (!existsSync(SCRIPT)) {
    throw new Error(`Missing orchestrator: ${SCRIPT}`);
  }
  const bin = pythonBin();
  const spawned = spawnSync(bin, [SCRIPT, ...(opts?.extraArgs ?? [])], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (spawned.error) throw spawned.error;
  if (spawned.status !== 0) {
    const err = (spawned.stderr || spawned.stdout || "").trim();
    throw new Error(`clz_diff.py exited ${spawned.status}: ${err || "no output"}`);
  }
  const result = parseStdout(spawned.stdout || "{}");
  result.triggeredBy = opts?.triggeredBy ?? "cli";
  if (spawned.stderr) process.stderr.write(spawned.stderr);
  return result;
}

export async function runClzDiffJobAsync(opts?: { triggeredBy?: string; extraArgs?: string[] }) {
  return runClzDiffJob(opts);
}
