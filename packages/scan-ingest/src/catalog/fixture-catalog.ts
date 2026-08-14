import type { CatalogCard } from "../schemas.js";

/**
 * Minimal sports + TCG fixture catalog for offline ID matching.
 * Production will swap in Postgres / pokemontcg / sports DB adapters.
 */
export const FIXTURE_CATALOG: CatalogCard[] = [
  {
    catalogKey: "pokemon:base-set:4:charizard",
    category: "pokemon",
    displayName: "Charizard",
    setName: "Base Set",
    collectorNumber: "4",
    playerOrCharacter: "Charizard",
    year: 1999,
    searchText: "charizard base set 4/102 holo rare pokemon tcg",
    externalIds: [
      { source: "pokemontcg", value: "base1-4" },
      { source: "collector_number", value: "4/102" },
    ],
  },
  {
    catalogKey: "pokemon:sv:215:pikachu",
    category: "pokemon",
    displayName: "Pikachu",
    setName: "Scarlet & Violet",
    collectorNumber: "025",
    playerOrCharacter: "Pikachu",
    year: 2023,
    searchText: "pikachu scarlet violet 025 pokemon tcg",
    externalIds: [{ source: "pokemontcg", value: "sv1-25" }],
  },
  {
    catalogKey: "sports:topps:1986:jordan:57",
    category: "sports",
    displayName: "1986 Topps Michael Jordan #57",
    setName: "1986 Topps",
    collectorNumber: "57",
    playerOrCharacter: "Michael Jordan",
    year: 1986,
    searchText: "1986 topps michael jordan 57 basketball rookie",
    externalIds: [{ source: "cardladder", value: "1986-topps-jordan-57" }],
  },
  {
    catalogKey: "sports:panini:prizm:2023:wembanyama:136",
    category: "sports",
    displayName: "2023 Panini Prizm Victor Wembanyama #136",
    setName: "2023 Panini Prizm",
    collectorNumber: "136",
    playerOrCharacter: "Victor Wembanyama",
    year: 2023,
    searchText: "2023 panini prizm victor wembanyama 136 basketball",
    externalIds: [{ source: "cardladder", value: "2023-prizm-wemby-136" }],
  },
  {
    catalogKey: "mtg:lea:black-lotus",
    category: "mtg",
    displayName: "Black Lotus",
    setName: "Limited Edition Alpha",
    collectorNumber: null,
    playerOrCharacter: "Black Lotus",
    year: 1993,
    searchText: "black lotus alpha mtg magic the gathering",
    externalIds: [{ source: "scryfall", value: "lea-black-lotus" }],
  },
];
