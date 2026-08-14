import type { ComicRow, ComicsMeta } from "./comicTypes";
import { apiGet, type Holding } from "./api";
import { holdingToComicRow, metaFromHoldings } from "./holdingToComic";
import {
  INBOX_POLL_MAX_MS,
  INBOX_POLL_MS,
  INBOX_UPLOAD_TIMEOUT_MS,
  type InboxDropResult,
  type InboxStatus,
} from "./sourceDrop";

const COMICS_BASE = process.env.NEXT_PUBLIC_COMICS_API_URL ?? "";

// A stuck (not just down) comics API would otherwise hang this fetch forever
// and freeze the whole terminal on load — always bound it.
const COMICS_TIMEOUT_MS = 5000;

async function tryComicsApi(): Promise<{ meta: ComicsMeta; inventory: ComicRow[] } | null> {
  // Browser: relative proxy. Server: optional absolute comics API.
  const prefix = typeof window === "undefined" ? COMICS_BASE || "http://127.0.0.1:5200" : "";
  try {
    const [metaRes, invRes] = await Promise.all([
      fetch(`${prefix}/api/comics/meta`, {
        cache: "no-store",
        signal: AbortSignal.timeout(COMICS_TIMEOUT_MS),
      }),
      fetch(`${prefix}/api/comics/inventory`, {
        cache: "no-store",
        signal: AbortSignal.timeout(COMICS_TIMEOUT_MS),
      }),
    ]);
    if (!metaRes.ok || !invRes.ok) return null;
    const meta = (await metaRes.json()) as ComicsMeta;
    const inventory = (await invRes.json()) as ComicRow[];
    if (!Array.isArray(inventory) || inventory.length === 0) return null;
    return { meta: { ...meta, source: meta.source ?? "comics-api" }, inventory };
  } catch {
    return null;
  }
}

/** Prefer live Comics Postgres API; fall back to VIP inventory (same decision surface). */
export async function loadComicsTerminalData(): Promise<{
  meta: ComicsMeta;
  inventory: ComicRow[];
  source: "comics-api" | "vip-api";
}> {
  const fromComics = await tryComicsApi();
  if (fromComics) {
    return {
      meta: fromComics.meta,
      inventory: fromComics.inventory,
      source: "comics-api",
    };
  }

  const data = await apiGet<{ holdings: Holding[] }>("/api/inventory");
  const inventory = data.holdings.map(holdingToComicRow);
  const meta = metaFromHoldings(inventory);
  return { meta, inventory, source: "vip-api" };
}

export async function patchComicHolding(
  id: string,
  fields: Record<string, unknown>,
): Promise<ComicRow | null> {
  const prefix = typeof window === "undefined" ? COMICS_BASE || "http://127.0.0.1:5200" : "";
  try {
    const res = await fetch(`${prefix}/api/comics/holding/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
      signal: AbortSignal.timeout(COMICS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { row?: ComicRow };
    return data.row ?? null;
  } catch {
    return null;
  }
}

function comicsPrefix(): string {
  return typeof window === "undefined" ? COMICS_BASE || "http://127.0.0.1:5200" : "";
}

export async function fetchComicsInboxStatus(): Promise<InboxStatus | null> {
  try {
    const res = await fetch(`${comicsPrefix()}/api/comics/inbox`, {
      cache: "no-store",
      signal: AbortSignal.timeout(COMICS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as InboxStatus;
  } catch {
    return null;
  }
}

export async function uploadComicsInboxFile(file: File): Promise<InboxDropResult> {
  const res = await fetch(`${comicsPrefix()}/api/comics/inbox`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/xml",
      "X-Filename": file.name,
    },
    body: file,
    signal: AbortSignal.timeout(INBOX_UPLOAD_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as InboxDropResult;
  if (!res.ok) {
    return { ok: false, error: data.error || `Upload failed (${res.status})` };
  }
  return { ...data, ok: true };
}

export async function waitForComicsInboxDrain(
  timeoutMs = INBOX_POLL_MAX_MS,
): Promise<InboxStatus | null> {
  const start = Date.now();
  let last: InboxStatus | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await fetchComicsInboxStatus();
    if (last && (last.pendingCount ?? 0) === 0) return last;
    await new Promise((r) => setTimeout(r, INBOX_POLL_MS));
  }
  return last;
}
