/**
 * Multi-word trainer / item / stadium / energy titles.
 * Single English verbs (Switch, Potion) are omitted — they appear in attack text.
 */
export const TRAINER_ITEM_TITLES: readonly string[] = [
  "Premium Power Pro",
  "Black Belt's Training",
  "Brock's Scouting",
  "Jumbo Ice Cream",
  "Professor's Research",
  "Boss's Orders",
  "Night Stretcher",
  "Rare Candy",
  "Nest Ball",
  "Ultra Ball",
  "Quick Ball",
  "Luxury Ball",
  "Great Ball",
  "Poke Ball",
  "Poké Ball",
  "Super Rod",
  "Earthen Vessel",
  "Buddy-Buddy Poffin",
  "Counter Catcher",
  "Unfair Stamp",
  "Area Zero Underdepths",
  "Energy Search",
  "Energy Retrieval",
  "Super Energy Retrieval",
  "Basic Grass Energy",
  "Basic Fire Energy",
  "Basic Water Energy",
  "Basic Lightning Energy",
  "Basic Psychic Energy",
  "Basic Fighting Energy",
  "Basic Darkness Energy",
  "Basic Metal Energy",
  "Basic Fairy Energy",
  "Basic Dragon Energy",
  "Basic Energy",
];

/** Distinctive attack names → species. Only attacks that are unique enough for OCR fallback. */
export const ATTACK_NAME_HINTS: Readonly<Record<string, string>> = {
  "double stab": "Pikipek",
  "disperse drool": "Gloom",
  "smoldering scales": "Volcarona",
  "prison panic": "Brambleghast",
  "electric run": "Boltund",
  "iron buster": "Escavalier",
  "bashing through thick ice": "Seel",
  "damage counters from being placed on benched": "Battle Cage",
  "coated attack": "Archaludon",
};
