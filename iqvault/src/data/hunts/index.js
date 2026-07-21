import { absoluteBatmanHunt } from "./absoluteBatman.js";
import { pokemon30thHunt } from "./pokemon30th.js";
import { pokemonSinglesPlaceholder } from "./pokemonSinglesPlaceholder.js";

export { absoluteBatmanHunt, pokemon30thHunt, pokemonSinglesPlaceholder };

export const HUNTS = [absoluteBatmanHunt, pokemon30thHunt, pokemonSinglesPlaceholder];

export function getHunt(id) {
  return HUNTS.find((h) => h.id === id) ?? null;
}

export function getActiveHunts() {
  return HUNTS.filter((h) => h.status === "active");
}
