import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { formatClzSyncReport, runClzSyncJob, type ClzSyncResult } from "./clz-sync.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE = join(
  REPO_ROOT,
  "packages",
  "ingest",
  "src",
  "__tests__",
  "fixtures",
  "clz-sample.xml",
);

describe("clz-sync job", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("formats empty inbox and skip reports", () => {
    const empty: ClzSyncResult = {
      job: "clz-sync",
      ranAt: "2026-08-14T00:00:00Z",
      inbox: "E:/ComicArchive/inbox",
      archive: "E:/ComicArchive",
      empty: true,
      reason: "empty_inbox",
      files: [],
    };
    expect(formatClzSyncReport(empty)).toContain("empty=true");

    const skipped: ClzSyncResult = {
      ...empty,
      empty: false,
      files: [{ file: "export.xml", skipped: true, already_current: true }],
    };
    expect(formatClzSyncReport(skipped)).toContain("already current");
  });

  it("offline second pass of the CLZ fixture is a hash skip", () => {
    const dir = mkdtempSync(join(tmpdir(), "clz-job-"));
    dirs.push(dir);
    const inbox = join(dir, "inbox");
    const archive = join(dir, "archive");
    mkdirSync(inbox, { recursive: true });
    copyFileSync(FIXTURE, join(inbox, "export.xml"));

    const extra = [
      "--offline",
      "--inbox",
      inbox,
      "--archive",
      archive,
      "--hash-file",
      join(archive, ".hashes.json"),
    ];
    const first = runClzSyncJob({ triggeredBy: "test", extraArgs: extra });
    expect(first.job).toBe("clz-sync");
    expect(first.empty).toBe(false);
    expect(first.files[0]?.skipped).toBeFalsy();

    copyFileSync(FIXTURE, join(inbox, "export.xml"));
    const second = runClzSyncJob({ triggeredBy: "test", extraArgs: extra });
    expect(second.files[0]?.skipped).toBe(true);
    expect(second.files[0]?.already_current).toBe(true);
    expect(formatClzSyncReport(second)).toContain("already current");
  });
});
