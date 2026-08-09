/**
 * Layout presets (from binder-builder.html) + curated 9-slot "era" templates
 * with role labels and a highlighted CENTER chase (from the ME template).
 */

export type PocketPreset = {
  key: string;
  label: string;
  rows: number;
  cols: number;
  custom?: boolean;
};

export const POCKET_PRESETS: PocketPreset[] = [
  { key: "9", label: "9-Pocket", rows: 3, cols: 3 },
  { key: "12", label: "12-Pocket", rows: 4, cols: 3 },
  { key: "4", label: "4-Pocket (Toploader)", rows: 2, cols: 2 },
  { key: "20", label: "20-Pocket Sheet", rows: 5, cols: 4 },
  { key: "custom", label: "Custom", rows: 3, cols: 3, custom: true },
];

export const SPINE_COLORS = [
  "#7a2331",
  "#223a5e",
  "#2f4b3c",
  "#4b2e4f",
  "#33323a",
  "#a97d2c",
];

/** A 9-slot themed page: 3x3, index 4 (center) is the chase highlight. */
export type EraTemplate = {
  key: string;
  name: string;
  tone: string;
  subtitle: string;
  /** 9 role labels, top-left to bottom-right. */
  roles: string[];
};

export const ERA_TEMPLATES: EraTemplate[] = [
  {
    key: "mega-evolution",
    name: "Mega Evolution",
    tone: "#385C7C",
    subtitle: "Era Launch Page • cover-page template for the ME block",
    roles: [
      "Era Icon",
      "Kanto Anchor",
      "Trainer / Mechanic",
      "Secondary Mega",
      "CHASE #1",
      "Chase #2",
      "Collector Goal",
      "Legendary / Mythic",
      "Signature Art",
    ],
  },
  {
    key: "chaos-rising",
    name: "Chaos Rising",
    tone: "#78437D",
    subtitle: "Set Page • build the identity first, upgrade later",
    roles: [
      "Set Theme",
      "Major Character",
      "Trainer / Story",
      "Secondary Chase",
      "CHASE #1",
      "Chase #2",
      "Fan Favorite",
      "Competitive Card",
      "Signature Art",
    ],
  },
  {
    key: "perfect-order",
    name: "Perfect Order",
    tone: "#637548",
    subtitle: "Set Page • structure, order, trainer story, and premium art",
    roles: [
      "Order Theme",
      "Major Character",
      "Trainer / Story",
      "Secondary Chase",
      "CHASE #1",
      "Chase #2",
      "Fan Favorite",
      "Legendary / Mythic",
      "Signature Art",
    ],
  },
  {
    key: "ascended-heroes",
    name: "Ascended Heroes",
    tone: "#876C33",
    subtitle: "Set Page • hero cards, god-pack representative, long-term anchors",
    roles: [
      "Hero Theme",
      "Top Illustration",
      "Trainer / Story",
      "Secondary Chase",
      "CHASE #1",
      "Chase #2",
      "God Pack Rep",
      "Fan Favorite",
      "Prestige Finale",
    ],
  },
  {
    key: "phantasmal-flames",
    name: "Phantasmal Flames",
    tone: "#7A342E",
    subtitle: "Set Page • ghost/fire identity with low-cost placeholders first",
    roles: [
      "Flame Theme",
      "Major Character",
      "Trainer / Story",
      "Haunted Theme",
      "CHASE #1",
      "Chase #2",
      "Fan Favorite",
      "Legendary / Mythic",
      "Signature Art",
    ],
  },
];

export const CENTER_INDEX_3x3 = 4;

export function eraByKey(key: string | null | undefined): EraTemplate | null {
  if (!key) return null;
  return ERA_TEMPLATES.find((e) => e.key === key) ?? null;
}
