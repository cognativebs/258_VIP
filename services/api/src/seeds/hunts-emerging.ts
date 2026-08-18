import { item, type Hunt } from "./hunts.js";

const SOURCE =
  "Conversation synthesis 2026-08-15 · prices/print runs unverified · investigate before paying up";

export const carlaCohenHunt: Hunt = {
  id: "carla-cohen",
  slug: "carla-cohen",
  name: "Modern Cover Artist — Carla Cohen Museum",
  status: "active",
  category: "comic",
  suggestion: true,
  suggestionNote:
    "Not a Cohen completion pillar. Cap 9–18 books. Score each cover; stop at ~$500. Artgerm / Frison / Middleton / Parrillo sit in the same watch category.",
  description:
    "Selective museum tier — early work + iconic character + outstanding image + documented low print + virgin/foil only when scarcity is real. Do not buy the artist, buy everything. Her store listing 57 variants is the dilution warning. Cohen/Parrillo paired/connecting/signed books are a legitimate sub-collection, not more SKUs.",
  sections: [
    {
      id: "a-plus",
      name: "A+ / A — hunt hardest (early + iconic)",
      items: [
        item("cc-ww-bg-1", "Wonder Woman: Black & Gold #1 — Comics Elite", {
          status: "missing",
          priority: "critical",
          notes: `A+ · #1 + WW + 2021 early Cohen + recognizable image. Favorite. ${SOURCE}`,
        }),
        item("cc-dot-11-marilyn", "Department of Truth #11 — Marilyn Monroe homage", {
          status: "missing",
          priority: "critical",
          notes: `A+ · Jul 2021 virgin documented on GCD. Early obscure > new $100 foil. ${SOURCE}`,
        }),
        item("cc-dot-11-elvis", "Department of Truth #11 — Elvis homage", {
          status: "missing",
          priority: "high",
          notes: `A · Same early-period thesis; unusual subject. ${SOURCE}`,
        }),
        item("cc-dienamite-sonja", "Die!Namite #1 Red Sonja Virgin LTD 500", {
          status: "missing",
          priority: "critical",
          buyUnder: 40,
          notes: `A · Verify 500-copy run (Mar 2021 collector sale at $20). 2020/21 + #1 + Sonja + 500. ${SOURCE}`,
        }),
      ],
    },
    {
      id: "a-minus",
      name: "A− — standout images, buy cheap",
      items: [
        item("cc-cat-45", "Catwoman #45 “Milk Thief”", {
          status: "missing",
          priority: "high",
          notes: `A− · Standout Catwoman / artist fit. ${SOURCE}`,
        }),
        item("cc-ivy-9", "Poison Ivy #9 Harley/Ivy", {
          status: "wanted",
          priority: "high",
          buyUnder: 20,
          market: 20,
          notes: `A− art / B investment. Signature DC image. 2026 raw ~$6–$27; CGC 9.8 ~$48–$64. BUY CHEAP — do not chase $100. ${SOURCE}`,
        }),
      ],
    },
    {
      id: "b-watch",
      name: "B+ / B / Watch — opportunistic only",
      items: [
        item("cc-abs-power-3", "Absolute Power #3 Wonder Woman", {
          status: "missing",
          priority: "medium",
          notes: `B+ · Strong modern WW; collector attention. ${SOURCE}`,
        }),
        item("cc-ww-25-nycc", "Wonder Woman #25 NYCC LTD 1,000", {
          status: "missing",
          priority: "medium",
          notes: `B+ · Later-period; identifiable scarcity if LTD 1,000 confirmed. ${SOURCE}`,
        }),
        item("cc-ivy33-hq50", "Poison Ivy #33 / Harley Quinn #50 connecting set", {
          status: "missing",
          priority: "medium",
          notes: `B+ · Connecting-cover collecting + Harley/Ivy. ${SOURCE}`,
        }),
        item("cc-pg-sg", "Power Girl / Supergirl connecting cover", {
          status: "missing",
          priority: "medium",
          notes: `B+ speculative · Early collector response strong. ${SOURCE}`,
        }),
        item("cc-vamp-666", "Vampirella #666", {
          status: "missing",
          priority: "low",
          notes: `B · Artist/character match + milestone numbering. ${SOURCE}`,
        }),
        item("cc-dot-12", "Department of Truth #12 Elvis variants", {
          status: "missing",
          priority: "low",
          notes: `B · Extends early Cohen/DoT group. ${SOURCE}`,
        }),
        item("cc-dot-16", "Department of Truth #16 Fight Club homage", {
          status: "missing",
          priority: "low",
          notes: `B · Cultural homage + early work. ${SOURCE}`,
        }),
        item("cc-abs-ww", "Absolute Wonder Woman Cohen covers", {
          status: "missing",
          priority: "low",
          notes: `B speculative · Same art already sold as signed standard / virgin / virgin foil — manufactured SKU scarcity. ${SOURCE}`,
        }),
        item("cc-siktc-1-10th", "Something Is Killing the Children #1 10th print Cohen", {
          status: "missing",
          priority: "low",
          notes: `Watch · Major franchise, 2026 + variant-heavy. ${SOURCE}`,
        }),
      ],
    },
    {
      id: "allocation",
      name: "$500 stop-rule (do not complete)",
      items: [
        item("cc-alloc-early", "$150 — early 2020–22 Cohen", { status: "wanted", priority: "critical", buyUnder: 150 }),
        item("cc-alloc-ww", "$100 — best Wonder Woman", { status: "wanted", priority: "high", buyUnder: 100 }),
        item("cc-alloc-cat", "$75 — best Catwoman", { status: "wanted", priority: "high", buyUnder: 75 }),
        item("cc-alloc-ivy", "$50 — Poison Ivy #9 bought cheaply", { status: "wanted", priority: "high", buyUnder: 50 }),
        item("cc-alloc-ltd", "$50 — one genuine LTD ≤500", { status: "wanted", priority: "high", buyUnder: 50 }),
        item("cc-alloc-cgc", "$75 — opportunistic CGC 9.8 / SS", { status: "wanted", priority: "medium", buyUnder: 75 }),
      ],
    },
  ],
};

export const onePieceFemaleHunt: Hunt = {
  id: "one-piece-female",
  slug: "one-piece-female",
  name: "One Piece — Icons + Heroines",
  status: "active",
  category: "one_piece",
  suggestion: true,
  suggestionNote:
    "Two museum pages, not a set completion. Comfortable $500–$2,000 in selected singles — not random $150 OP-XX chase. Markets are conversation snapshots · unverified.",
  description:
    "Strongest non-Pokémon TCG thesis: character × rarity × early issue × scarcity. Female-character high-end is real (Heroines EB-03, Manga Rares). Prefer OP01 / Manga / event / major SP over ordinary alts.",
  sections: [
    {
      id: "icons-9",
      name: "ONE PIECE ICONS — 9-card museum",
      items: [
        item("op-luffy-early", "Early Luffy", { status: "missing", priority: "critical", notes: "Icon page · historical centerpiece slot if Manga Rare." }),
        item("op-zoro-early", "Early Zoro", { status: "missing", priority: "high" }),
        item("op-nami-op01", "OP01 Nami Parallel", {
          status: "missing",
          priority: "critical",
          market: 412,
          notes: `OP01 + Nami + Parallel + early history. TCGplayer ~$412 snapshot · unverified. Prefer over random $400 OP15 chase. ${SOURCE}`,
        }),
        item("op-manga-1", "Manga Rare (historic centerpiece)", { status: "missing", priority: "critical" }),
        item("op-manga-2", "Manga Rare (pair)", { status: "missing", priority: "high" }),
        item("op-hancock-icon", "Boa Hancock (icon page)", { status: "missing", priority: "critical" }),
        item("op-robin-icon", "Nico Robin (icon page)", { status: "missing", priority: "high" }),
        item("op-event-nami", "2025 New Year Event Winner Nami", {
          status: "missing",
          priority: "high",
          notes: "In-store event winners only — scarcity mechanism VIP should notice.",
        }),
        item("op-promo", "Early/event/promo", { status: "missing", priority: "medium" }),
      ],
    },
    {
      id: "heroines-s",
      name: "HEROINES — Tier S",
      items: [
        item("op-nami-eb03", "Nami EB03-053 SP", {
          status: "missing",
          priority: "critical",
          market: 1314,
          notes: `Heroines Edition EB-03. Market ~$1,314 snapshot · unverified. ${SOURCE}`,
        }),
        item("op-hancock-eb03", "Boa Hancock EB03-026 SP", {
          status: "missing",
          priority: "critical",
          market: 1336,
          notes: `~ $1,336 snapshot · unverified. ${SOURCE}`,
        }),
        item("op-hancock-op07-manga", "Boa Hancock OP07 Manga Rare", {
          status: "missing",
          priority: "critical",
          market: 2194,
          notes: `~ $2,194 snapshot · unverified. ${SOURCE}`,
        }),
      ],
    },
    {
      id: "heroines-a",
      name: "HEROINES — Tier A",
      items: [
        item("op-robin", "Nico Robin (premium treatment)", { status: "missing", priority: "high" }),
        item("op-uta-manga", "Uta Manga Rare", {
          status: "missing",
          priority: "high",
          market: 969,
          notes: `~ $969 snapshot · unverified. ${SOURCE}`,
        }),
        item("op-vivi", "Nefertari Vivi", { status: "missing", priority: "high" }),
      ],
    },
    {
      id: "heroines-b",
      name: "HEROINES — Tier B",
      items: [
        item("op-perona", "Perona", { status: "missing", priority: "medium" }),
        item("op-bonney", "Jewelry Bonney", { status: "missing", priority: "medium" }),
        item("op-yamato", "Yamato", { status: "missing", priority: "medium" }),
        item("op-rebecca", "Rebecca", { status: "missing", priority: "low" }),
      ],
    },
  ],
};

export const gundamHunt: Hunt = {
  id: "gundam",
  slug: "gundam",
  name: "Gundam — Historical Foundation Museum",
  status: "active",
  category: "gundam",
  suggestion: true,
  suggestionNote:
    "Highest “we might be early” bet. $300–$500 experiment, not $2,000. Launch-cycle boom ≠ sustainable returns. Bandai print/event stats are marketing context, not provenance.",
  description:
    "50-year IP, 2025 TCG. Collect foundational cards collectors will ask for in 10 years: earliest + iconic Mobile Suit + major character + structural scarcity + first-era sealed. Not “which card is expensive today.”",
  sections: [
    {
      id: "suits",
      name: "Iconic Mobile Suits",
      items: [
        item("gdm-rx78", "RX-78-2 Gundam", { status: "missing", priority: "critical" }),
        item("gdm-wing", "Wing Gundam / Wing Zero", { status: "missing", priority: "high" }),
        item("gdm-unicorn", "Unicorn Gundam", { status: "missing", priority: "high" }),
        item("gdm-nu", "ν Gundam", { status: "missing", priority: "high" }),
        item("gdm-zeta", "Zeta Gundam", { status: "missing", priority: "medium" }),
        item("gdm-freedom", "Freedom / Strike Freedom", { status: "missing", priority: "medium" }),
        item("gdm-sazabi", "Sazabi", { status: "missing", priority: "medium" }),
        item("gdm-barbatos", "Barbatos", { status: "missing", priority: "medium" }),
      ],
    },
    {
      id: "characters",
      name: "Major characters",
      items: [
        item("gdm-char", "Char Aznable (premium early)", { status: "missing", priority: "critical", notes: "More compelling than an equally rare obscure pilot." }),
        item("gdm-amuro", "Amuro Ray", { status: "missing", priority: "high" }),
        item("gdm-heero", "Heero Yuy", { status: "missing", priority: "medium" }),
        item("gdm-kira", "Kira Yamato", { status: "missing", priority: "medium" }),
      ],
    },
    {
      id: "experiment",
      name: "$300–$500 experiment (then watch 6–12 months)",
      items: [
        item("gdm-single", "$150–$250 — premium iconic single", { status: "wanted", priority: "critical", buyUnder: 250 }),
        item("gdm-sealed", "$100–$150 — first-era sealed", { status: "wanted", priority: "high", buyUnder: 150 }),
        item("gdm-promos", "$50–$100 — early/promotional pieces", { status: "wanted", priority: "medium", buyUnder: 100 }),
      ],
    },
  ],
};

export const lorcanaHunt: Hunt = {
  id: "lorcana",
  slug: "lorcana",
  name: "Lorcana — Disney Icons (First Chapter)",
  status: "active",
  category: "lorcana",
  suggestion: true,
  suggestionNote:
    "Treat as Disney art collecting, not competitive chase. First Chapter Enchanteds outrank newer Iconics on history. D23 / earliest promos before buying deeply.",
  description:
    "Disney cultural importance × early Lorcana history × premium rarity. Elsa / Mickey / Stitch / Belle / Tinker Bell / Maleficent. Twenty years from now nobody explains who Elsa is.",
  sections: [
    {
      id: "first-chapter-legendary",
      name: "First Chapter Legendary Enchanteds",
      items: [
        item("lor-elsa", "Elsa – Spirit of Winter Enchanted", {
          status: "missing",
          priority: "critical",
          market: 917,
          notes: `Museum piece: first set + highest original rarity + major Disney + flagship chase. TCGplayer ~$917 raw snapshot · unverified. ${SOURCE}`,
        }),
        item("lor-belle", "Belle – Strange But Special Enchanted", { status: "missing", priority: "high" }),
        item("lor-stitch", "Stitch – Carefree Surfer Enchanted", { status: "missing", priority: "high" }),
      ],
    },
    {
      id: "first-chapter-other",
      name: "Other First Chapter Enchanteds",
      items: [
        item("lor-mickey", "Mickey Enchanted", { status: "missing", priority: "high" }),
        item("lor-tink", "Tinker Bell Enchanted", { status: "missing", priority: "high" }),
        item("lor-aurora", "Aurora Enchanted", { status: "missing", priority: "medium" }),
        item("lor-simba", "Simba Enchanted", { status: "missing", priority: "medium" }),
        item("lor-maui", "Maui Enchanted", { status: "missing", priority: "medium" }),
        item("lor-genie", "Genie Enchanted", { status: "missing", priority: "medium" }),
        item("lor-aladdin", "Aladdin Enchanted", { status: "missing", priority: "low" }),
        item("lor-hades", "Hades Enchanted", { status: "missing", priority: "low" }),
        item("lor-mal", "Maleficent (premium early)", { status: "missing", priority: "high" }),
      ],
    },
    {
      id: "watch",
      name: "Watch — do not auto-rank above First Chapter",
      items: [
        item("lor-d23", "D23 / earliest promotional cards", {
          status: "missing",
          priority: "high",
          notes: "Stronger historical argument than the 37th Enchanted from a future set.",
        }),
        item("lor-iconic-lilo", "Lilo & Stitch – Fun-Loving Friends Iconic", {
          status: "missing",
          priority: "low",
          notes: "Newer Iconic rarity — watch, do not assume > older Enchanteds.",
        }),
        item("lor-iconic-belle-beast", "Belle & Beast – Certain as the Sun Iconic", {
          status: "missing",
          priority: "low",
        }),
      ],
    },
  ],
};

export const printLifeHunt: Hunt = {
  id: "print-life-swsh",
  slug: "print-life-swsh",
  name: "Pokémon print-life — SWSH sleeved + SV watch",
  status: "active",
  category: "pokemon",
  suggestion: true,
  suggestionNote:
    "No official OOP registry; Pokémon reprints. Manual watch — do not auto-classify. Evolving Skies at $12.99 = buy now. Current Mega Evolution at $12.99 = pass.",
  description:
    "Detect ACTIVE PRINT → DECLINING SUPPLY → LIKELY FINAL WAVE → EFFECTIVELY OOP before the market prices it in. Hunt older SWSH hangers on the LGS wall first.",
  sections: [
    {
      id: "swsh-buy",
      name: "At $12.99 sleeved",
      items: [
        item("pl-es", "Evolving Skies", { status: "wanted", priority: "critical", buyUnder: 13, notes: "BUY immediately" }),
        item("pl-fs", "Fusion Strike", { status: "wanted", priority: "high", buyUnder: 13, notes: "Very interested" }),
        item("pl-bs", "Brilliant Stars", { status: "wanted", priority: "high", buyUnder: 13 }),
        item("pl-lo", "Lost Origin", { status: "wanted", priority: "high", buyUnder: 13 }),
        item("pl-st", "Silver Tempest", { status: "wanted", priority: "high", buyUnder: 13 }),
        item("pl-ar", "Astral Radiance", { status: "wanted", priority: "medium", buyUnder: 13, notes: "Probably buy some" }),
        item("pl-cz", "Crown Zenith (pack format)", { status: "wanted", priority: "critical", notes: "No normal 36-pack box — sleeved/pack is the SKU" }),
        item("pl-go", "Pokémon GO", { status: "missing", priority: "low", notes: "Probably pass" }),
      ],
    },
    {
      id: "sv-watch",
      name: "Early SV — track, do not call OOP",
      items: [
        item("pl-sv", "Scarlet & Violet Base", { status: "missing", priority: "medium" }),
        item("pl-pe", "Paldea Evolved", { status: "missing", priority: "medium" }),
        item("pl-of", "Obsidian Flames", { status: "missing", priority: "medium" }),
        item("pl-151", "151", { status: "missing", priority: "high" }),
        item("pl-pr", "Paradox Rift", { status: "missing", priority: "low" }),
        item("pl-pf", "Paldean Fates", { status: "missing", priority: "low" }),
        item("pl-tf", "Temporal Forces", { status: "missing", priority: "low" }),
      ],
    },
  ],
};

export const modernArtistWatchHunt: Hunt = {
  id: "modern-cover-artists",
  slug: "modern-cover-artists",
  name: "Modern Cover Artist watch — Artgerm / Frison / Middleton / Parrillo / Cohen",
  status: "active",
  category: "comic",
  suggestion: true,
  suggestionNote: "Watch category, not five giant pillars. Identify each artist’s 10 most important existing covers next.",
  description:
    "IQVault watch bucket for modern cover artists with collector followings. Cohen is the first scored museum (9–18 cap). Parrillo pairing is a sub-collection, not SKU accumulation.",
  sections: [
    {
      id: "artists",
      name: "Watch list",
      items: [
        item("mca-cohen", "Carla Cohen — museum tier started", { status: "wanted", priority: "critical" }),
        item("mca-artgerm", "Stanley “Artgerm” Lau — identify top 10", { status: "missing", priority: "high" }),
        item("mca-frison", "Jenny Frison — identify top 10", { status: "missing", priority: "high" }),
        item("mca-middleton", "Joshua Middleton — identify top 10", { status: "missing", priority: "medium" }),
        item("mca-parrillo", "Lucio Parrillo — Cohen/Parrillo 2025 CGC signing pair", { status: "missing", priority: "high" }),
      ],
    },
  ],
};
