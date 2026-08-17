/** Bloomberg collection verticals — same tab bar as the original IQVault HTML terminal. */

export type CollectionTab = {
  id: string;
  href: string;
  label: string;
  shortLabel: string;
  group: "comics" | "tcg" | "sports";
  icon: string;
  status: "live" | "planned";
};

export const COLLECTION_GROUPS = [
  { id: "comics", label: "Comics" },
  { id: "tcg", label: "TCG" },
  { id: "sports", label: "Sportscards" },
] as const;

export const COLLECTION_TABS: CollectionTab[] = [
  {
    id: "comic",
    href: "/collections/comics",
    label: "Comics",
    shortLabel: "Comics",
    group: "comics",
    icon: "📚",
    status: "live",
  },
  {
    id: "pokemon",
    href: "/collections/pokemon",
    label: "Pokémon",
    shortLabel: "Pokémon",
    group: "tcg",
    icon: "⚡",
    status: "live",
  },
  {
    id: "mtg",
    href: "/collections/sports",
    label: "Magic: The Gathering",
    shortLabel: "MTG",
    group: "tcg",
    icon: "🔮",
    status: "planned",
  },
  {
    id: "football",
    href: "/collections/sports",
    label: "Football",
    shortLabel: "Football",
    group: "sports",
    icon: "🏈",
    status: "planned",
  },
  {
    id: "soccer",
    href: "/collections/sports",
    label: "Soccer",
    shortLabel: "Soccer",
    group: "sports",
    icon: "⚽",
    status: "planned",
  },
  {
    id: "basketball",
    href: "/collections/sports",
    label: "Basketball",
    shortLabel: "Basketball",
    group: "sports",
    icon: "🏀",
    status: "planned",
  },
  {
    id: "baseball",
    href: "/collections/sports",
    label: "Baseball",
    shortLabel: "Baseball",
    group: "sports",
    icon: "⚾",
    status: "planned",
  },
];
