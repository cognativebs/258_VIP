import { z } from "zod";

export const collectionTabSchema = z.object({
  id: z.enum(["comic", "pokemon", "mtg", "football", "soccer", "basketball", "baseball"]),
  kind: z.enum(["comic", "pokemon", "mtg", "sports"]),
  label: z.string().min(1),
  shortLabel: z.string().min(1),
  group: z.enum(["comics", "tcg", "sports"]),
  terminalLabel: z.string().min(1),
  status: z.enum(["live"]),
  schema: z.string().min(1),
  unit: z.enum(["books", "cards"]),
  sport: z.string().optional(),
  workspaces: z.array(z.string()).optional(),
});

export type CollectionTab = z.infer<typeof collectionTabSchema>;
export type CollectionTabId = CollectionTab["id"];

export const COLLECTION_GROUPS = [
  { id: "comics" as const, label: "Comics" },
  { id: "tcg" as const, label: "TCG" },
  { id: "sports" as const, label: "Sportscards" },
];

export const COLLECTION_TABS: CollectionTab[] = collectionTabSchema.array().parse([
  {
    id: "comic",
    kind: "comic",
    label: "Comics",
    shortLabel: "Comics",
    group: "comics",
    terminalLabel: "COMICS TERMINAL",
    status: "live",
    schema: "vault_comic",
    unit: "books",
  },
  {
    id: "pokemon",
    kind: "pokemon",
    label: "Pokemon",
    shortLabel: "Pokemon",
    group: "tcg",
    terminalLabel: "POKEMON TCG TERMINAL",
    status: "live",
    schema: "vault_pokemon",
    unit: "cards",
    workspaces: ["ALL", "OWNED", "NEED", "SINGLES", "SEALED", "GRADE", "LIQ MOVE", "MUSEUM", "SELL"],
  },
  {
    id: "mtg",
    kind: "mtg",
    label: "Magic: The Gathering",
    shortLabel: "MTG",
    group: "tcg",
    terminalLabel: "MTG TERMINAL",
    status: "live",
    schema: "vault_mtg",
    unit: "cards",
    workspaces: ["ALL", "OWNED", "NEED", "COMMANDER", "FOIL", "GRADE", "LIQ MOVE", "SELL"],
  },
  {
    id: "football",
    kind: "sports",
    sport: "football",
    label: "Football",
    shortLabel: "Football",
    group: "sports",
    terminalLabel: "FOOTBALL TERMINAL",
    status: "live",
    schema: "vault_sports",
    unit: "cards",
    workspaces: ["ALL", "ROOKIE", "AUTO", "PATCH", "PARALLEL", "GRADE", "SELL"],
  },
  {
    id: "soccer",
    kind: "sports",
    sport: "soccer",
    label: "Soccer",
    shortLabel: "Soccer",
    group: "sports",
    terminalLabel: "SOCCER TERMINAL",
    status: "live",
    schema: "vault_sports",
    unit: "cards",
    workspaces: ["ALL", "ROOKIE", "AUTO", "PARALLEL", "GRADE", "LIQ MOVE", "SELL"],
  },
  {
    id: "basketball",
    kind: "sports",
    sport: "basketball",
    label: "Basketball",
    shortLabel: "Basketball",
    group: "sports",
    terminalLabel: "BASKETBALL TERMINAL",
    status: "live",
    schema: "vault_sports",
    unit: "cards",
    workspaces: ["ALL", "ROOKIE", "AUTO", "PARALLEL", "GRADE", "SELL"],
  },
  {
    id: "baseball",
    kind: "sports",
    sport: "baseball",
    label: "Baseball",
    shortLabel: "Baseball",
    group: "sports",
    terminalLabel: "BASEBALL TERMINAL",
    status: "live",
    schema: "vault_sports",
    unit: "cards",
    workspaces: ["ALL", "ROOKIE", "AUTO", "PARALLEL", "GRADE", "SELL"],
  },
]);

export function getCollectionTab(id: string): CollectionTab {
  return COLLECTION_TABS.find((t) => t.id === id) ?? COLLECTION_TABS[0];
}

export function isCollectionTabId(id: string): id is CollectionTabId {
  return COLLECTION_TABS.some((t) => t.id === id);
}

export function workspaceChips(tab: CollectionTab): { id: string; label: string }[] {
  if (tab.kind === "comic" || !tab.workspaces?.length) {
    return [];
  }
  return tab.workspaces.map((label) => ({
    id: label.toLowerCase().replace(/\s+/g, "-"),
    label,
  }));
}
