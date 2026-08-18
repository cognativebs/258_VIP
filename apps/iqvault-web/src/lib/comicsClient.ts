import type { ComicRow, ComicsMeta } from "./comicTypes";
import { apiGet, type Holding } from "./api";
import type { CollectionTabId } from "./collectionTabs";
import { holdingToComicRow, metaFromHoldings } from "./holdingToComic";
import { holdingsForTab } from "./verticalInventory";

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

/** Comics: Postgres API first. Other verticals: VIP holdings classified onto that tab. */
export async function loadVerticalTerminalData(tabId: CollectionTabId): Promise<{
  meta: ComicsMeta;
  inventory: ComicRow[];
  source: "comics-api" | "vip-api";
}> {
  if (tabId === "comic") {
    return loadComicsTerminalData();
  }
  const data = await apiGet<{ holdings: Holding[] }>("/api/inventory");
  const inventory = holdingsForTab(data.holdings, tabId).map(holdingToComicRow);
  const meta = metaFromHoldings(inventory);
  meta.source = "vip-api";
  meta.snapshotLabel = `${tabId} · VIP inventory · inferred classification`;
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
