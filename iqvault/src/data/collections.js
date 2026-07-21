/** Collection verticals — aligned with vault_core.categories + sports sub-filters */

export const COLLECTION_TABS = [
  {
    id: "comic",
    kind: "comic",
    label: "Comics",
    shortLabel: "Comics",
    group: "comics",
    icon: "📚",
    terminalLabel: "COMICS TERMINAL",
    status: "live",
    schema: "vault_comic",
    unit: "books",
  },
  {
    id: "pokemon",
    kind: "pokemon",
    label: "Pokémon",
    shortLabel: "Pokémon",
    group: "tcg",
    icon: "⚡",
    terminalLabel: "POKÉMON TCG TERMINAL",
    status: "planned",
    schema: "vault_pokemon",
    unit: "cards",
    workspaces: ["ALL", "SEALED", "SINGLES", "GRADE", "LIQ MOVE", "MUSEUM", "SELL"],
  },
  {
    id: "mtg",
    kind: "mtg",
    label: "Magic: The Gathering",
    shortLabel: "MTG",
    group: "tcg",
    icon: "🔮",
    terminalLabel: "MTG TERMINAL",
    status: "planned",
    schema: "vault_mtg",
    unit: "cards",
    workspaces: ["ALL", "COMMANDER", "RESERVE", "FOIL", "GRADE", "LIQ MOVE", "SELL"],
  },
  {
    id: "football",
    kind: "sports",
    sport: "football",
    label: "Football",
    shortLabel: "Football",
    group: "sports",
    icon: "🏈",
    terminalLabel: "FOOTBALL TERMINAL",
    status: "planned",
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
    icon: "⚽",
    terminalLabel: "SOCCER TERMINAL",
    status: "planned",
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
    icon: "🏀",
    terminalLabel: "BASKETBALL TERMINAL",
    status: "planned",
    schema: "vault_sports",
    unit: "cards",
    workspaces: ["ALL", "ROOKIE", "AUTO", "PARALLEL", "GRADE", "LIQ MOVE", "SELL"],
  },
  {
    id: "baseball",
    kind: "sports",
    sport: "baseball",
    label: "Baseball",
    shortLabel: "Baseball",
    group: "sports",
    icon: "⚾",
    terminalLabel: "BASEBALL TERMINAL",
    status: "planned",
    schema: "vault_sports",
    unit: "cards",
    workspaces: ["ALL", "ROOKIE", "AUTO", "PARALLEL", "GRADE", "LIQ MOVE", "SELL"],
  },
];

export const COLLECTION_GROUPS = [
  { id: "comics", label: "Comics" },
  { id: "tcg", label: "TCG" },
  { id: "sports", label: "Sportscards" },
];

export function getCollectionTab(id) {
  return COLLECTION_TABS.find((t) => t.id === id) ?? COLLECTION_TABS[0];
}

export function tabsForGroup(groupId) {
  return COLLECTION_TABS.filter((t) => t.group === groupId);
}
