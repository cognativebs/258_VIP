import type { ComicRow, ComicsMeta } from "./comicTypes";
import { apiGet, type Holding, type InventoryResponse } from "./api";
import { holdingToComicRow, metaFromHoldings } from "./holdingToComic";

const COMICS_BASE = process.env.NEXT_PUBLIC_COMICS_API_URL ?? "";

// Probe stays short so a dead :5200 falls through to VIP quickly.
// Full inventory is ~2.5MB for ~2,700 comics — match VIP's 30s budget.
// The previous 5s inventory timeout made a healthy Comics API look "down"
// and forced the read-only VIP path even when :5200 was serving.
const COMICS_PROBE_MS = 3000;
const COMICS_INVENTORY_TIMEOUT_MS = 30_000;
const COMICS_MUTATION_TIMEOUT_MS = 15_000;

function comicsPrefix(): string {
  // Browser: relative proxy (/api/comics → :5200). Server: absolute.
  return typeof window === "undefined" ? COMICS_BASE || "http://127.0.0.1:5200" : "";
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
 * Prefer the Python Comics API (:5200) when up — it supports live edits.
 * Otherwise use VIP inventory, which now reads the same Postgres collection
 * (read-only). Never invent a sample portfolio when both are down.
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
  return { meta, inventory, source: "vip-api", editable: false };
}

export async function patchComicHolding(
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
