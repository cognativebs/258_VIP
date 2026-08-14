/**
 * CLZ inbox sync job — polls a drop folder for Comic Collector XML exports.
 *
 * Env:
 *   CLZ_INBOX_DIR, CLZ_ARCHIVE_DIR, IQVAULT_DATABASE_DSN / DATABASE_URL
 *   PYTHON / python3 on PATH
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "clz_sync.py");

export type ClzSyncFileResult = {
  file?: string;
  contentHash?: string;
  skipped?: boolean;
  already_current?: boolean;
  reason?: string;
  archive?: string;
  recordCount?: number;
  delta?: {
    added?: string[];
    updated?: string[];
    dropped?: string[];
    revived?: string[];
    price_changed?: string[];
    unchanged?: number;
    skipped_duplicate_hash?: boolean;
    already_current?: boolean;
  };
  stats?: Record<string, number>;
};

export type ClzSyncResult = {
  job: string;
  ranAt: string;
  inbox: string;
  archive: string;
  empty: boolean;
  reason?: string;
  files: ClzSyncFileResult[];
  triggeredBy?: string;
};

function pythonBin(): string {
  if (process.env.PYTHON) return process.env.PYTHON;
  return process.platform === "win32" ? "python" : "python3";
}

export function formatClzSyncReport(result: ClzSyncResult): string {
  const lines = [
    `[clz-sync] inbox=${result.inbox}`,
    `  empty=${result.empty}${result.reason ? ` (${result.reason})` : ""}`,
  ];
  for (const f of result.files) {
    if (f.skipped || f.already_current) {
      lines.push(`  skip ${f.file ?? "xml"} — already current`);
      continue;
    }
    const d = f.delta ?? {};
    lines.push(
      `  ${f.file ?? "xml"} added=${(d.added ?? []).length} dropped=${(d.dropped ?? []).length} ` +
        `price_changed=${(d.price_changed ?? []).length} revived=${(d.revived ?? []).length}`,
    );
  }
  return lines.join("\n");
}

function parseStdout(stdout: string): ClzSyncResult {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith("{"));
  if (!jsonLine) {
    throw new Error("clz_sync.py produced no JSON result");
  }
  const parsed = JSON.parse(jsonLine) as ClzSyncResult;
  if (!parsed || parsed.job !== "clz-sync") {
    throw new Error("clz_sync.py did not return a clz-sync JSON result");
  }
  return parsed;
}

export function runClzSyncJob(opts?: {
  triggeredBy?: string;
  extraArgs?: string[];
  python?: string;
}): ClzSyncResult {
  if (!existsSync(SCRIPT)) {
    throw new Error(`Missing orchestrator: ${SCRIPT}`);
  }
  const bin = opts?.python ?? pythonBin();
  const args = [SCRIPT, ...(opts?.extraArgs ?? [])];
  const spawned = spawnSync(bin, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (spawned.error) {
    throw spawned.error;
  }
  if (spawned.status !== 0) {
    const err = (spawned.stderr || spawned.stdout || "").trim();
    throw new Error(`clz_sync.py exited ${spawned.status}: ${err || "no output"}`);
  }
  const result = parseStdout(spawned.stdout || "{}");
  result.triggeredBy = opts?.triggeredBy ?? "cli";
  if (spawned.stderr) {
    process.stderr.write(spawned.stderr);
  }
  return result;
}

export async function runClzSyncJobAsync(opts?: {
  triggeredBy?: string;
  extraArgs?: string[];
}): Promise<ClzSyncResult> {
  return runClzSyncJob(opts);
}
