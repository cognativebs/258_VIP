import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importFolderPages, isImageFile, resolveScanFolder } from "./scanFolder.js";

afterEach(() => {
  delete process.env.VIP_SCAN_INBOX;
});

function makeInbox(): string {
  return mkdtempSync(join(tmpdir(), "vip-scan-"));
}

describe("resolveScanFolder", () => {
  it("refuses a blank folder when no inbox is configured", () => {
    const result = resolveScanFolder(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/VIP_SCAN_INBOX/);
  });

  it("falls back to the configured inbox", () => {
    const inbox = makeInbox();
    process.env.VIP_SCAN_INBOX = inbox;
    const result = resolveScanFolder(undefined);
    expect(result).toEqual({ ok: true, path: inbox });
  });

  it("keeps requests inside the inbox root", () => {
    const inbox = makeInbox();
    process.env.VIP_SCAN_INBOX = inbox;
    const escape = resolveScanFolder("../../etc");
    expect(escape.ok).toBe(false);

    const nested = resolveScanFolder("batch-1");
    expect(nested.ok).toBe(true);
    if (nested.ok) expect(nested.path).toBe(join(inbox, "batch-1"));
  });
});

describe("isImageFile", () => {
  it("accepts scanner output formats only", () => {
    expect(isImageFile("001_front.jpg")).toBe(true);
    expect(isImageFile("001_back.TIF")).toBe(true);
    expect(isImageFile("index.json")).toBe(false);
  });
});

describe("importFolderPages", () => {
  it("hashes images and pairs duplex pages front/back", async () => {
    const inbox = makeInbox();
    process.env.VIP_SCAN_INBOX = inbox;
    const batchDir = join(inbox, "batch-1");
    mkdirSync(batchDir);
    writeFileSync(join(batchDir, "001_front.jpg"), "front-bytes");
    writeFileSync(join(batchDir, "002_back.jpg"), "back-bytes");
    writeFileSync(join(batchDir, "notes.txt"), "ignore me");

    const result = await importFolderPages({ folder: "batch-1", categoryHint: "sports" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fileCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.face).toBe("front");
    expect(result.pages[1]?.face).toBe("back");
    // Distinct bytes must hash differently or duplex pairing collapses.
    expect(result.pages[0]?.contentHash).not.toBe(result.pages[1]?.contentHash);
  });

  it("reads an optional OCR sidecar next to each image", async () => {
    const inbox = makeInbox();
    process.env.VIP_SCAN_INBOX = inbox;
    writeFileSync(join(inbox, "1986_topps_michael_jordan_57_front.jpg"), "front");
    writeFileSync(join(inbox, "1986_topps_michael_jordan_57_back.jpg"), "back");
    writeFileSync(
      join(inbox, "1986_topps_michael_jordan_57_back.txt"),
      "1986 Topps Michael Jordan 57",
    );

    const result = await importFolderPages({ folder: undefined, pairing: "filename_front_back" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const back = result.pages.find((p) => p.fileName.includes("_back"));
    const front = result.pages.find((p) => p.fileName.includes("_front"));
    expect(back?.ocrText).toEqual("1986 Topps Michael Jordan 57");
    expect(front?.ocrText).toBeNull();
  });

  it("reports an empty folder instead of opening a batch", async () => {
    const inbox = makeInbox();
    process.env.VIP_SCAN_INBOX = inbox;
    const result = await importFolderPages({ folder: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No scan images/);
  });

  it("404s a missing folder", async () => {
    const inbox = makeInbox();
    process.env.VIP_SCAN_INBOX = inbox;
    const result = await importFolderPages({ folder: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});
