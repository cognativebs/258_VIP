import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
  FolderWatchAdapter,
  type PairingStrategy,
  type ScanCategory,
} from "@vip/scan-ingest";

/**
 * Read a PaperStream drop folder into scan pages.
 *
 * The scanner itself is driven by PaperStream Capture; VIP only picks up what
 * it wrote. Keeping this on the API (not the browser) means the collector face
 * can start a batch without curl, and file bytes never travel through the UI.
 */

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"];

/** Configured inbox root; folder requests must stay inside it when set. */
export function scanInboxRoot(): string | null {
  const raw = process.env.VIP_SCAN_INBOX?.trim();
  return raw ? resolve(raw) : null;
}

export function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export type ResolveFolderResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Resolve the requested folder against the inbox root.
 * A relative path is always joined to the root. An absolute path is only
 * accepted when it stays inside the root, so the API cannot be used to read
 * arbitrary disk locations.
 */
export function resolveScanFolder(requested?: string | null): ResolveFolderResult {
  const root = scanInboxRoot();
  const wanted = requested?.trim();

  if (!wanted) {
    if (!root) {
      return {
        ok: false,
        error:
          "No folder given and VIP_SCAN_INBOX is not set. Set VIP_SCAN_INBOX to your PaperStream output folder.",
      };
    }
    return { ok: true, path: root };
  }

  if (!root) {
    if (!isAbsolute(wanted)) {
      return {
        ok: false,
        error: "Relative folder requires VIP_SCAN_INBOX to be set.",
      };
    }
    return { ok: true, path: resolve(wanted) };
  }

  const candidate = isAbsolute(wanted) ? resolve(wanted) : resolve(join(root, wanted));
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return {
      ok: false,
      error: `Folder must be inside VIP_SCAN_INBOX (${root}).`,
    };
  }
  return { ok: true, path: candidate };
}

export type FolderPage = {
  fileName: string;
  storageRef: string;
  contentHash: string;
  mimeType?: string;
};

/** Hash every image in the folder (sorted by name for stable duplex pairing). */
export async function readFolderPages(
  folder: string,
  opts: { maxFiles?: number } = {},
): Promise<FolderPage[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && isImageFile(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const limit = opts.maxFiles ?? 500;
  const selected = files.slice(0, limit);

  const pages: FolderPage[] = [];
  for (const name of selected) {
    const full = join(folder, name);
    const bytes = await readFile(full);
    pages.push({
      fileName: name,
      storageRef: full,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return pages;
}

export type ImportFolderRequest = {
  folder?: string | null;
  categoryHint?: ScanCategory | null;
  pairing?: PairingStrategy;
  notes?: string;
  maxFiles?: number;
};

export type ImportFolderResult =
  | {
      ok: true;
      folder: string;
      fileCount: number;
      pages: Array<{
        storageRef: string;
        contentHash: string;
        mimeType: string;
        fileName: string;
        face: "front" | "back" | "unknown";
        sequence: number;
      }>;
    }
  | { ok: false; status: 400 | 404; error: string };

/** Turn a drop folder into the page list `POST /api/scan/batches` accepts. */
export async function importFolderPages(
  req: ImportFolderRequest,
): Promise<ImportFolderResult> {
  const resolved = resolveScanFolder(req.folder);
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };

  try {
    const info = await stat(resolved.path);
    if (!info.isDirectory()) {
      return { ok: false, status: 400, error: `Not a folder: ${resolved.path}` };
    }
  } catch {
    return { ok: false, status: 404, error: `Folder not found: ${resolved.path}` };
  }

  const files = await readFolderPages(resolved.path, { maxFiles: req.maxFiles });
  if (files.length === 0) {
    return {
      ok: false,
      status: 400,
      error: `No scan images in ${resolved.path} (looked for ${IMAGE_EXTENSIONS.join(", ")}).`,
    };
  }

  const adapter = new FolderWatchAdapter({
    rootLabel: resolved.path,
    pairing: req.pairing ?? "sequential_duplex",
    categoryHint: req.categoryHint ?? null,
  });
  const pages = adapter.ingestDescriptors(files);

  return {
    ok: true,
    folder: resolved.path,
    fileCount: files.length,
    pages: pages.map((p, i) => ({
      storageRef: p.storageRef,
      contentHash: p.contentHash,
      mimeType: p.mimeType,
      fileName: p.fileName ?? files[i]?.fileName ?? `page-${i}`,
      face: p.face ?? "unknown",
      sequence: p.sequence ?? i,
    })),
  };
}
