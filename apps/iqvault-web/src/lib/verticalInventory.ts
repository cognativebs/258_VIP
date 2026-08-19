import { z } from "zod";
import type { Holding } from "./api";
import type { CollectionTab, CollectionTabId } from "./collectionTabs";
import type { ComicRow } from "./comicTypes";
import { filterByWorkspace } from "./comicEngine";

export const verticalIdSchema = z.enum([
  "comic",
  "pokemon",
  "mtg",
  "football",
  "soccer",
  "basketball",
  "baseball",
  "unknown",
]);

export type VerticalId = z.infer<typeof verticalIdSchema>;

const TCG_SOURCES = new Set(["pokemontcg", "tcgdex", "scryfall", "mtgjson"]);

function haystack(h: Holding): string {
  return [h.publisher, h.series, h.assetName, h.pillar, h.issue].filter(Boolean).join(" ").toLowerCase();
}

/** Classify a VIP holding into a collection vertical. Inferred — never stored as verified. */
export function classifyHoldingVertical(h: Holding): VerticalId {
  const text = haystack(h);
  const sources = new Set((h.externalIds ?? []).map((e) => e.source.toLowerCase()));
  const tcgLike =
    h.id.startsWith("binder-slot-") ||
    (h.pillar?.startsWith("TCG ") ?? false) ||
    [...sources].some((s) => TCG_SOURCES.has(s));

  if (tcgLike) {
    if (sources.has("scryfall") || sources.has("mtgjson") || /\b(mtg|magic:|wizards of the coast)\b/.test(text)) {
      return "mtg";
    }
    return "pokemon";
  }

  if (/\b(topps|panini|upper deck|bowman|prizm|optic|select|donruss)\b/.test(text)) {
    if (/\b(nfl|football|gridiron)\b/.test(text)) return "football";
    if (/\b(nba|basketball)\b/.test(text)) return "basketball";
    if (/\b(mlb|baseball)\b/.test(text)) return "baseball";
    if (/\b(soccer|fifa|premier league|mls)\b/.test(text)) return "soccer";
    return "unknown";
  }

  return "comic";
}

export function holdingsForTab(holdings: Holding[], tabId: CollectionTabId): Holding[] {
  if (tabId === "comic") {
    return holdings.filter((h) => classifyHoldingVertical(h) === "comic");
  }
  return holdings.filter((h) => classifyHoldingVertical(h) === tabId);
}

function rowText(r: ComicRow): string {
  return [
    r.Series,
    r.Title,
    r["Edition / Variant"],
    r.Publisher,
    r["Collection Pillar"],
    r.Tags,
    r["Verification Notes"],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterByVerticalWorkspace(
  rows: ComicRow[],
  workspace: string,
  tab: CollectionTab,
): ComicRow[] {
  if (tab.kind === "comic") {
    return filterByWorkspace(rows, workspace);
  }

  const id = workspace.toLowerCase().replace(/\s+/g, "-");
  switch (id) {
    case "all":
    case "":
      return rows;
    case "owned":
      return rows.filter((r) => String(r["Collection Pillar"] ?? "").includes("Owned"));
    case "need":
      return rows.filter((r) => String(r["Collection Pillar"] ?? "").includes("Need"));
    case "sealed":
      return rows.filter((r) => /\b(sealed|booster|etb|tin|box|case)\b/.test(rowText(r)));
    case "singles":
      return rows.filter((r) => !/\b(sealed|booster|etb|tin|box|case)\b/.test(rowText(r)));
    case "commander":
      return rows.filter((r) => /\bcommander\b/.test(rowText(r)));
    case "foil":
      return rows.filter((r) => /\bfoil\b/.test(rowText(r)));
    case "rookie":
      return rows.filter((r) => /\brookie\b/.test(rowText(r)));
    case "auto":
      return rows.filter((r) => /\b(auto|autograph)\b/.test(rowText(r)));
    case "patch":
      return rows.filter((r) => /\bpatch\b/.test(rowText(r)));
    case "parallel":
      return rows.filter((r) => /\bparallel\b/.test(rowText(r)));
    case "museum":
      return filterByWorkspace(rows, "museum");
    case "sell":
      return filterByWorkspace(rows, "sell");
    case "liq-move":
    case "liquidity":
      return filterByWorkspace(rows, "liquidity");
    case "grade":
      return filterByWorkspace(rows, "grade");
    default:
      return filterByWorkspace(rows, workspace);
  }
}
