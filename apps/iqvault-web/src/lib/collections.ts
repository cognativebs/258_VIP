import type { Holding } from "./api";

/**
 * Collection registry for the collector face.
 *
 * Comics and TCG already live in the same Postgres and arrive together on
 * `/api/inventory`; splitting them here keeps one source of truth while giving
 * each asset class its own page instead of a comics-only app.
 */

export type CollectionId = "comics" | "tcg" | "sports";

export type CollectionDef = {
  id: CollectionId;
  label: string;
  href: string;
  blurb: string;
};

export const COLLECTIONS: CollectionDef[] = [
  {
    id: "comics",
    label: "Comics",
    href: "/collections/comics",
    blurb: "CLZ import in Postgres — Bloomberg-style terminal with filters and Ask.",
  },
  {
    id: "tcg",
    label: "TCG / Binder",
    href: "/collections/tcg",
    blurb: "Pokemon binder pockets — owned and still-needed, priced from Binder.",
  },
  {
    id: "sports",
    label: "Sports",
    href: "/collections/sports",
    blurb: "Catalog schema only so far — Scan intake is the path in until a holdings loader exists.",
  },
];

export function isTcgHolding(h: Holding): boolean {
  return (
    h.id.startsWith("binder-slot-") ||
    !!h.pillar?.startsWith("TCG ") ||
    (h.externalIds?.some((e) =>
      ["pokemontcg", "tcgdex", "tcgplayer"].includes(e.source.toLowerCase()),
    ) ??
      false)
  );
}

export function isComicHolding(h: Holding): boolean {
  return !isTcgHolding(h) && h.provenance?.source === "clz_import";
}

export type TcgSplit = {
  owned: Holding[];
  need: Holding[];
  /** Pokémon seed rows kept separate so they are never shown as binder truth. */
  seeds: Holding[];
  ownedValue: number;
  needValue: number;
};

export function splitTcgHoldings(holdings: Holding[]): TcgSplit {
  const tcg = holdings.filter(isTcgHolding);
  const owned = tcg.filter((h) => h.pillar === "TCG Owned (Binder)");
  const need = tcg.filter((h) => h.pillar === "TCG Need (Binder)");
  const seeds = tcg.filter(
    (h) => !h.id.startsWith("binder-slot-") && !h.pillar?.startsWith("TCG "),
  );
  const sum = (rows: Holding[]) =>
    rows.reduce((acc, h) => acc + (h.currentPrice ?? 0) * (h.quantity || 1), 0);
  return {
    owned,
    need,
    seeds,
    ownedValue: sum(owned.length ? owned : seeds),
    needValue: sum(need),
  };
}
