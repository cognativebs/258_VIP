import { z } from "zod";

/**
 * Bloomberg collection verticals — same tab bar as the original IQVault HTML
 * terminal. Each tab keeps an explicit `href`: routes are real pages under
 * app/collections/<vertical>, not one dynamic [vertical] route.
 *
 * `status` is honest about what exists. Only comics and Pokémon read live
 * holdings today; the rest are `planned` and point at the sports stub.
 */
export const collectionTabSchema = z.object({
  id: z.enum(["comic", "pokemon", "mtg", "football", "soccer", "basketball", "baseball"]),
  /** Which inventory shape the tab reads. Several sports ids share one kind. */
  kind: z.enum(["comic", "pokemon", "mtg", "sports"]),
  href: z.string().startsWith("/"),
  label: z.string().min(1),
  shortLabel: z.string().min(1),
  group: z.enum(["comics", "tcg", "sports"]),
  terminalLabel: z.string().min(1),
  icon: z.string().min(1),
  status: z.enum(["live", "planned"]),
  /** Postgres schema that would back this vertical. */
  schema: z.string().min(1),
  unit: z.enum(["books", "cards"]),
  sport: z.string().optional(),
  workspaces: z.array(z.string()).optional(),
});

export type CollectionTab = z.infer<typeof collectionTabSchema>;
export type CollectionTabId = CollectionTab["id"];
export type CollectionTabKind = CollectionTab["kind"];

export const COLLECTION_GROUPS = [
  { id: "comics", label: "Comics" },
  { id: "tcg", label: "TCG" },
  { id: "sports", label: "Sportscards" },
] as const;

export const COLLECTION_TABS: CollectionTab[] = collectionTabSchema.array().parse([
  {
    id: "comic",
    kind: "comic",
    href: "/collections/comics",
    label: "Comics",
    shortLabel: "Comics",
    group: "comics",
    terminalLabel: "COMICS TERMINAL",
    icon: "📚",
    status: "live",
    schema: "vault_comic",
    unit: "books",
  },
  {
    id: "pokemon",
    kind: "pokemon",
    href: "/collections/pokemon",
    label: "Pokémon",
    shortLabel: "Pokémon",
    group: "tcg",
    terminalLabel: "POKÉMON TCG TERMINAL",
    icon: "⚡",
    status: "live",
    schema: "vault_pokemon",
    unit: "cards",
    workspaces: ["ALL", "OWNED", "NEED", "SINGLES", "SEALED", "GRADE", "LIQ MOVE", "MUSEUM", "SELL"],
  },
  {
    id: "mtg",
    kind: "mtg",
    href: "/collections/sports",
    label: "Magic: The Gathering",
    shortLabel: "MTG",
    group: "tcg",
    terminalLabel: "MTG TERMINAL",
    icon: "🔮",
    status: "planned",
    schema: "vault_mtg",
    unit: "cards",
    workspaces: ["ALL", "OWNED", "NEED", "COMMANDER", "FOIL", "GRADE", "LIQ MOVE", "SELL"],
  },
  {
    id: "football",
    kind: "sports",
    href: "/collections/sports",
    label: "Football",
    shortLabel: "Football",
    group: "sports",
    terminalLabel: "FOOTBALL TERMINAL",
    icon: "🏈",
    status: "planned",
    schema: "vault_sports",
    unit: "cards",
    sport: "football",
    workspaces: ["ALL", "ROOKIE", "AUTO", "PATCH", "PARALLEL", "GRADE", "SELL"],
  },
  {
    id: "soccer",
    kind: "sports",
    href: "/collections/sports",
    label: "Soccer",
    shortLabel: "Soccer",
    group: "sports",
    terminalLabel: "SOCCER TERMINAL",
    icon: "⚽",
    status: "planned",
    schema: "vault_sports",
    unit: "cards",
    sport: "soccer",
    workspaces: ["ALL", "ROOKIE", "AUTO", "PATCH", "PARALLEL", "GRADE", "SELL"],
  },
  {
    id: "basketball",
    kind: "sports",
    href: "/collections/sports",
    label: "Basketball",
    shortLabel: "Basketball",
    group: "sports",
    terminalLabel: "BASKETBALL TERMINAL",
    icon: "🏀",
    status: "planned",
    schema: "vault_sports",
    unit: "cards",
    sport: "basketball",
    workspaces: ["ALL", "ROOKIE", "AUTO", "PATCH", "PARALLEL", "GRADE", "SELL"],
  },
  {
    id: "baseball",
    kind: "sports",
    href: "/collections/sports",
    label: "Baseball",
    shortLabel: "Baseball",
    group: "sports",
    terminalLabel: "BASEBALL TERMINAL",
    icon: "⚾",
    status: "planned",
    schema: "vault_sports",
    unit: "cards",
    sport: "baseball",
    workspaces: ["ALL", "ROOKIE", "AUTO", "PATCH", "PARALLEL", "GRADE", "SELL"],
  },
]);

export function getCollectionTab(id: string): CollectionTab | null {
  return COLLECTION_TABS.find((t) => t.id === id) ?? null;
}
