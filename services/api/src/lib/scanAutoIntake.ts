/**
 * Automatic Ricoh intake (operator decision 2026-10-10): every few minutes, look at
 * VIP_SCAN_INBOX and its sub-folders and import a folder as a scan batch when every image in
 * it is new to VIP and nothing in it has changed for a while (the scanner has finished).
 * A folder that mixes images VIP already holds with new ones is skipped and reported —
 * importing it would duplicate the old cards. Review stays on /scan; nothing is confirmed here.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { isImageFile, scanInboxRoot } from "./scanFolder.js";

export const SCAN_AUTO_INTAKE_RULE = "scan-auto-intake@0.1.0";
const DEFAULT_EVERY_MS = 5 * 60 * 1000;
const DEFAULT_QUIET_MS = 2 * 60 * 1000;
/** Folders the web upload path and masters use; never scanner output. */
const SKIP_DIRS = new Set(["uploads"]);

export type FolderFile = { name: string; hash: string; mtimeMs: number };
export type FolderScan = { path: string; files: FolderFile[] };
export type FolderDecision = {
  path: string;
  images: number;
  action: "import" | "skip";
  reason: string;
  categoryHint: "pokemon" | "mtg" | "sports" | null;
};

/** "…/Test Scans 25 Pokemon" → pokemon; "…/MTG binder" → mtg; otherwise sports (the Import default). */
export function categoryFromFolder(path: string): FolderDecision["categoryHint"] {
  const name = basename(path).toLowerCase();
  if (/pok[eé]mon|pkmn|\bptcg\b/.test(name)) return "pokemon";
  if (/\bmtg\b|magic/.test(name)) return "mtg";
  return "sports";
}

export function planAutoIntake(
  folders: ReadonlyArray<FolderScan>,
  knownHashes: ReadonlySet<string>,
  opts: { now: number; quietMs?: number },
): FolderDecision[] {
  const quietMs = opts.quietMs ?? DEFAULT_QUIET_MS;
  return folders.map((f) => {
    const base = { path: f.path, images: f.files.length, categoryHint: categoryFromFolder(f.path) };
    if (!f.files.length) return { ...base, action: "skip", reason: "no images" };
    const known = f.files.filter((x) => knownHashes.has(x.hash)).length;
    if (known === f.files.length) return { ...base, action: "skip", reason: "already imported" };
    if (known > 0) {
      return {
        ...base,
        action: "skip",
        reason: `${known} of ${f.files.length} images are already in VIP — import the new ones from /scan by hand`,
      };
    }
    const newest = Math.max(...f.files.map((x) => x.mtimeMs));
    if (opts.now - newest < quietMs) return { ...base, action: "skip", reason: "still being written — waiting" };
    return { ...base, action: "import", reason: `${f.files.length} new images` };
  });
}

// Content hashes by path + size + mtime, so unchanged files are not re-read every run.
const hashMemo = new Map<string, string>();

async function scanFolder(path: string): Promise<FolderScan> {
  const entries = await readdir(path, { withFileTypes: true });
  const files: FolderFile[] = [];
  for (const e of entries) {
    if (!e.isFile() || !isImageFile(e.name)) continue;
    const full = join(path, e.name);
    const st = await stat(full);
    const memoKey = `${full}|${st.size}|${st.mtimeMs}`;
    let hash = hashMemo.get(memoKey);
    if (!hash) {
      hash = createHash("sha256").update(await readFile(full)).digest("hex");
      hashMemo.set(memoKey, hash);
    }
    files.push({ name: e.name, hash, mtimeMs: st.mtimeMs });
  }
  return { path, files };
}

export async function listInboxFolders(root: string): Promise<FolderScan[]> {
  const out = [await scanFolder(root)];
  for (const e of await readdir(root, { withFileTypes: true })) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name.toLowerCase())) out.push(await scanFolder(join(root, e.name)));
  }
  return out;
}

async function knownScanHashes(): Promise<Set<string>> {
  const res = await getDb().execute(sql`
    SELECT front_content_hash AS h FROM vault_media.scan_unit
    UNION SELECT back_content_hash FROM vault_media.scan_unit WHERE back_content_hash IS NOT NULL
  `);
  return new Set((res.rows as Array<{ h: string }>).map((r) => r.h));
}

export type AutoIntakeStatus = {
  rule: typeof SCAN_AUTO_INTAKE_RULE;
  enabled: boolean;
  inbox: string | null;
  everyMs: number;
  lastRunAt: string | null;
  running: boolean;
  lastError: string | null;
  decisions: FolderDecision[];
  imported: Array<{ path: string; batchId: string; at: string }>;
};

const status: AutoIntakeStatus = {
  rule: SCAN_AUTO_INTAKE_RULE,
  enabled: false,
  inbox: null,
  everyMs: DEFAULT_EVERY_MS,
  lastRunAt: null,
  running: false,
  lastError: null,
  decisions: [],
  imported: [],
};

export function autoIntakeStatus(): AutoIntakeStatus {
  return { ...status, decisions: [...status.decisions], imported: [...status.imported] };
}

export type ImportFolder = (folder: string, categoryHint: FolderDecision["categoryHint"]) => Promise<{ batchId: string }>;

/** One pass. Never runs twice at once; an import failure is reported and retried next pass. */
export async function runAutoIntakeOnce(importFolder: ImportFolder, now = Date.now()): Promise<FolderDecision[]> {
  const root = scanInboxRoot();
  status.inbox = root;
  if (!root || status.running) return [];
  status.running = true;
  try {
    const decisions = planAutoIntake(await listInboxFolders(root), await knownScanHashes(), { now });
    for (const d of decisions.filter((x) => x.action === "import")) {
      try {
        const { batchId } = await importFolder(d.path, d.categoryHint);
        status.imported = [{ path: d.path, batchId, at: new Date().toISOString() }, ...status.imported].slice(0, 20);
        d.reason = `imported as batch ${batchId}`;
      } catch (e) {
        d.action = "skip";
        d.reason = `import failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    status.decisions = decisions;
    status.lastError = null;
    return decisions;
  } catch (e) {
    status.lastError = e instanceof Error ? e.message : String(e);
    return [];
  } finally {
    status.lastRunAt = new Date(now).toISOString();
    status.running = false;
  }
}

/** Started by the API when VIP_SCAN_INBOX is set; VIP_SCAN_AUTO_INTAKE=0 turns it off. */
export function startScanAutoIntake(importFolder: ImportFolder, env: NodeJS.ProcessEnv = process.env): () => void {
  if (env.VIP_SCAN_AUTO_INTAKE === "0" || !scanInboxRoot()) return () => {};
  status.enabled = true;
  status.everyMs = Number(env.VIP_SCAN_AUTO_INTAKE_MS ?? DEFAULT_EVERY_MS) || DEFAULT_EVERY_MS;
  const tick = () => void runAutoIntakeOnce(importFolder).then((ds) => {
    for (const d of ds.filter((x) => x.action === "import" || x.reason.startsWith("import failed"))) {
      console.log(`[scan-auto-intake] ${d.path}: ${d.reason}`);
    }
  });
  const first = setTimeout(tick, 30_000);
  const timer = setInterval(tick, status.everyMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    status.enabled = false;
  };
}
