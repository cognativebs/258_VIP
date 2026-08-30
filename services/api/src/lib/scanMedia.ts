import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { scanInboxRoot } from "./scanFolder.js";
import { scanMasterDir } from "./ricohIntake.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export function allowedScanRoots(): string[] {
  const roots = [
    resolve(scanMasterDir()),
    resolve(join(REPO_ROOT, "data", "scan-inbox")),
    resolve(join(REPO_ROOT, "data", "scan-masters")),
  ];
  const inbox = scanInboxRoot();
  if (inbox) roots.push(resolve(inbox));
  return [...new Set(roots)];
}

export function isAllowedScanPath(filePath: string): boolean {
  if (!isAbsolute(filePath)) return false;
  const resolved = resolve(filePath);
  return allowedScanRoots().some(
    (root) => resolved === root || resolved.startsWith(root + sep),
  );
}

function mimeFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "image/jpeg";
}

export async function lookupCaptureImagePath(imageId: string): Promise<string | null> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT storage_ref FROM vault_media.capture_image WHERE id = ${imageId}::uuid
  `);
  const row = (res.rows as Array<{ storage_ref: string }>)[0];
  return row?.storage_ref ?? null;
}

/** Stream a sandboxed master/derivative. Never follows a path outside scan roots. */
export async function sendScanMedia(res: Response, imageId: string): Promise<void> {
  const stored = await lookupCaptureImagePath(imageId);
  if (!stored || !isAllowedScanPath(stored)) {
    res.status(404).json({ error: "Scan image not found" });
    return;
  }
  try {
    const info = await stat(stored);
    if (!info.isFile()) {
      res.status(404).json({ error: "Scan image not found" });
      return;
    }
  } catch {
    res.status(404).json({ error: "Scan image not found" });
    return;
  }
  res.setHeader("Content-Type", mimeFromPath(stored));
  res.setHeader("Cache-Control", "private, max-age=3600");
  createReadStream(stored).pipe(res);
}
