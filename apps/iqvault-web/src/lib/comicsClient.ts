import type { ComicRow, ComicsMeta } from "./comicTypes";
import { apiGet, type Holding, type InventoryResponse } from "./api";
import { holdingToComicRow, metaFromHoldings } from "./holdingToComic";
import {
  INBOX_POLL_MAX_MS,
  INBOX_POLL_MS,
  INBOX_UPLOAD_TIMEOUT_MS,
  type InboxDropResult,
  type InboxStatus,
} from "./sourceDrop";

const COMICS_BASE = process.env.NEXT_PUBLIC_COMICS_API_URL ?? "";

// Probe stays short so a dead :5200 falls through to VIP quickly.
// Full inventory is ~2.5–4.5MB for ~2,700 comics — match VIP's 30s budget.
const COMICS_PROBE_MS = 3000;
const COMICS_INVENTORY_TIMEOUT_MS = 30_000;
const COMICS_MUTATION_TIMEOUT_MS = 15_000;

function comicsPrefix(): string {
  // Browser: relative proxy (/api/comics → :5200). Server: absolute.
  return typeof window === "undefined" ? COMICS_BASE || "http://127.0.0.1:5200" : "";
}

function vipPrefix(): string {
  if (process.env.NEXT_PUBLIC_VIP_API_URL) return process.env.NEXT_PUBLIC_VIP_API_URL;
  if (typeof window !== "undefined") return "/api/vip";
  return "http://127.0.0.1:8787";
}

async function tryComicsApi(): Promise<{ meta: ComicsMeta; inventory: ComicRow[] } | null> {
  const prefix = comicsPrefix();
  try {
    const healthRes = await fetch(`${prefix}/api/comics/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(COMICS_PROBE_MS),
    });
    if (!healthRes.ok) return null;
    const health = (await healthRes.json()) as { ok?: boolean };
    if (health.ok !== true) return null;

    const [metaRes, invRes] = await Promise.all([
      fetch(`${prefix}/api/comics/meta`, {
        cache: "no-store",
        signal: AbortSignal.timeout(COMICS_INVENTORY_TIMEOUT_MS),
      }),
      fetch(`${prefix}/api/comics/inventory`, {
        cache: "no-store",
        signal: AbortSignal.timeout(COMICS_INVENTORY_TIMEOUT_MS),
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

function isComicHolding(h: Holding): boolean {
  if (h.id.startsWith("binder-slot-")) return false;
  if (h.pillar?.startsWith("TCG ")) return false;
  if (h.externalIds?.some((e) => ["pokemontcg", "tcgdex", "tcgplayer"].includes(e.source))) {
    return false;
  }
  return h.provenance?.source === "clz_import";
}

/**
 * Prefer the Python Comics API (:5200) when up.
 * Otherwise use VIP inventory — same Postgres collection. VIP now accepts
 * holding patches, so the VIP path is editable when comicsAvailable.
 */
export async function loadComicsTerminalData(): Promise<{
  meta: ComicsMeta;
  inventory: ComicRow[];
  source: "comics-api" | "vip-api";
  editable: boolean;
}> {
  const fromComics = await tryComicsApi();
  if (fromComics) {
    return {
      meta: fromComics.meta,
      inventory: fromComics.inventory,
      source: "comics-api",
      editable: true,
    };
  }

  const data = await apiGet<InventoryResponse>("/api/inventory");
  if (!data.comicsAvailable) {
    throw new Error(
      data.comicsError
        ? `Comics inventory unavailable: ${data.comicsError}`
        : "Comics inventory unavailable — Postgres is down and no sample fallback is served",
    );
  }

  const inventory = data.holdings.filter(isComicHolding).map(holdingToComicRow);
  const meta = metaFromHoldings(inventory);
  if (data.comicsSnapshot) {
    meta.snapshotLabel = `${data.comicsSnapshot.label} · sha ${data.comicsSnapshot.shortHash} · age ${data.comicsSnapshot.ageDays}d`;
    meta.source = "vip-api-postgres";
  }
  return {
    meta,
    inventory,
    source: "vip-api",
    // Same Postgres as Comics API — edits go through VIP /api/comics/holding/:id.
    editable: true,
  };
}

async function patchViaComicsApi(
  id: string,
  fields: Record<string, unknown>,
): Promise<ComicRow | null> {
  const prefix = comicsPrefix();
  try {
    const res = await fetch(`${prefix}/api/comics/holding/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
      signal: AbortSignal.timeout(COMICS_MUTATION_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { row?: ComicRow };
    return data.row ?? null;
  } catch {
    return null;
  }
}

async function patchViaVipApi(
  id: string,
  fields: Record<string, unknown>,
): Promise<ComicRow | null> {
  try {
    const res = await fetch(`${vipPrefix()}/api/comics/holding/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
      cache: "no-store",
      signal: AbortSignal.timeout(COMICS_MUTATION_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { row?: ComicRow };
    return data.row ?? null;
  } catch {
    return null;
  }
}

export async function patchComicHolding(
  id: string,
  fields: Record<string, unknown>,
): Promise<ComicRow | null> {
  // Prefer Comics API when up; VIP is the durable path (same Postgres).
  const fromComics = await patchViaComicsApi(id, fields);
  if (fromComics) return fromComics;
  return patchViaVipApi(id, fields);
}

export async function fetchComicsInboxStatus(): Promise<InboxStatus | null> {
  try {
    const res = await fetch(`${comicsPrefix()}/api/comics/inbox`, {
      cache: "no-store",
      signal: AbortSignal.timeout(COMICS_PROBE_MS),
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
