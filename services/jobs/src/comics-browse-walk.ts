/**
 * Nightly eBay Browse inventory walk. One search per holding, not VIP_EBAY_QUERY.
 * Delegates to @vip/api comics-comps (rate-limited, resumable, idempotent per day).
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const EBAY_BROWSE_DAILY_CALL_CEILING = Number(process.env.VIP_EBAY_DAILY_CALL_CEILING ?? 5000);

export type ComicsBrowseWalkJobResult = {
  mode: "inventory_walk";
  ranAt: string;
  report: string;
  exitCode: number;
  dailyCallCeiling: number;
};

export function runComicsBrowseWalkJob(opts?: {
  resume?: boolean;
  triggeredBy?: string;
}): Promise<ComicsBrowseWalkJobResult> {
  const ranAt = new Date().toISOString();
  const args = [
    "run",
    "comics-comps",
    "-w",
    "@vip/api",
    "--",
    "--publishers=all",
  ];
  if (opts?.resume !== false) args.push("--resume");

  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd: ROOT,
      shell: true,
      env: { ...process.env, VIP_EBAY_TRIGGERED_BY: opts?.triggeredBy ?? "schedule" },
    });
    let report = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      report += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && exitCode !== 2) {
        reject(new Error(`comics-browse-walk exited ${exitCode}`));
        return;
      }
      resolve({
        mode: "inventory_walk",
        ranAt,
        report,
        exitCode,
        dailyCallCeiling: EBAY_BROWSE_DAILY_CALL_CEILING,
      });
    });
  });
}

export function formatComicsBrowseWalkReport(result: ComicsBrowseWalkJobResult): string {
  return [
    `ebay-browse-comps (${result.mode})`,
    `  dailyCallCeiling: ${result.dailyCallCeiling}`,
    `  nightlyCoverageCap: ${result.dailyCallCeiling} holdings (1 Browse search each)`,
    result.report.trim(),
  ].join("\n");
}
