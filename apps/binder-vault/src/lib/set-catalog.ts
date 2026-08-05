import type { SetOption } from "./filters";

/**
 * Always-available pokemontcg.io set ids. Upstream /sets is flaky (intermittent
 * 500s), so the picker must never depend on a live fetch to be usable.
 *
 * Newest first. Background refresh merges anything newer from the API/cache.
 */
export const SEED_SETS: SetOption[] = [
  { id: "me5", name: "Pitch Black", series: "Mega Evolution", releaseDate: "2026/07/17" },
  { id: "me4", name: "Chaos Rising", series: "Mega Evolution", releaseDate: "2026/05/22" },
  { id: "me3", name: "Perfect Order", series: "Mega Evolution", releaseDate: "2026/03/27" },
  { id: "me2pt5", name: "Ascended Heroes", series: "Mega Evolution", releaseDate: "2026/01/30" },
  { id: "me2", name: "Phantasmal Flames", series: "Mega Evolution", releaseDate: "2025/11/14" },
  { id: "me1", name: "Mega Evolution", series: "Mega Evolution", releaseDate: "2025/09/26" },
  { id: "zsv10pt5", name: "Black Bolt", series: "Scarlet & Violet", releaseDate: "2025/07/18" },
  { id: "rsv10pt5", name: "White Flare", series: "Scarlet & Violet", releaseDate: "2025/07/18" },
  { id: "sv10", name: "Destined Rivals", series: "Scarlet & Violet", releaseDate: "2025/05/30" },
  { id: "sv9", name: "Journey Together", series: "Scarlet & Violet", releaseDate: "2025/03/28" },
  { id: "sv8pt5", name: "Prismatic Evolutions", series: "Scarlet & Violet", releaseDate: "2025/01/17" },
  { id: "sv8", name: "Surging Sparks", series: "Scarlet & Violet", releaseDate: "2024/11/08" },
  { id: "sv7", name: "Stellar Crown", series: "Scarlet & Violet", releaseDate: "2024/09/13" },
  { id: "sv6pt5", name: "Shrouded Fable", series: "Scarlet & Violet", releaseDate: "2024/08/02" },
  { id: "sv6", name: "Twilight Masquerade", series: "Scarlet & Violet", releaseDate: "2024/05/24" },
  { id: "sv5", name: "Temporal Forces", series: "Scarlet & Violet", releaseDate: "2024/03/22" },
  { id: "sv4pt5", name: "Paldean Fates", series: "Scarlet & Violet", releaseDate: "2024/01/26" },
  { id: "sv4", name: "Paradox Rift", series: "Scarlet & Violet", releaseDate: "2023/11/03" },
  { id: "sv3pt5", name: "151", series: "Scarlet & Violet", releaseDate: "2023/09/22" },
  { id: "sv3", name: "Obsidian Flames", series: "Scarlet & Violet", releaseDate: "2023/08/11" },
  { id: "sv2", name: "Paldea Evolved", series: "Scarlet & Violet", releaseDate: "2023/06/09" },
  { id: "sv1", name: "Scarlet & Violet", series: "Scarlet & Violet", releaseDate: "2023/03/31" },
  { id: "svp", name: "SV Black Star Promos", series: "Scarlet & Violet", releaseDate: "2023/01/01" },
  { id: "swshp", name: "SWSH Black Star Promos", series: "Sword & Shield", releaseDate: "2019/11/15" },
  { id: "swsh12pt5", name: "Crown Zenith", series: "Sword & Shield", releaseDate: "2023/01/20" },
  { id: "swsh12", name: "Silver Tempest", series: "Sword & Shield", releaseDate: "2022/11/11" },
  { id: "swsh11", name: "Lost Origin", series: "Sword & Shield", releaseDate: "2022/09/09" },
  { id: "pgo", name: "Pokémon GO", series: "Sword & Shield", releaseDate: "2022/07/01" },
  { id: "swsh10", name: "Astral Radiance", series: "Sword & Shield", releaseDate: "2022/05/27" },
  { id: "swsh9", name: "Brilliant Stars", series: "Sword & Shield", releaseDate: "2022/02/25" },
  { id: "swsh8", name: "Fusion Strike", series: "Sword & Shield", releaseDate: "2021/11/12" },
  { id: "cel25", name: "Celebrations", series: "Sword & Shield", releaseDate: "2021/10/08" },
  { id: "swsh7", name: "Evolving Skies", series: "Sword & Shield", releaseDate: "2021/08/27" },
  { id: "swsh6", name: "Chilling Reign", series: "Sword & Shield", releaseDate: "2021/06/18" },
  { id: "swsh5", name: "Battle Styles", series: "Sword & Shield", releaseDate: "2021/03/19" },
  { id: "swsh45", name: "Shining Fates", series: "Sword & Shield", releaseDate: "2021/02/19" },
  { id: "swsh4", name: "Vivid Voltage", series: "Sword & Shield", releaseDate: "2020/11/13" },
  { id: "swsh35", name: "Champion's Path", series: "Sword & Shield", releaseDate: "2020/09/25" },
  { id: "swsh3", name: "Darkness Ablaze", series: "Sword & Shield", releaseDate: "2020/08/14" },
  { id: "swsh2", name: "Rebel Clash", series: "Sword & Shield", releaseDate: "2020/05/01" },
  { id: "swsh1", name: "Sword & Shield", series: "Sword & Shield", releaseDate: "2020/02/07" },
  { id: "smp", name: "SM Black Star Promos", series: "Sun & Moon", releaseDate: "2016/11/18" },
  { id: "sm115", name: "Hidden Fates", series: "Sun & Moon", releaseDate: "2019/08/23" },
  { id: "sm12", name: "Cosmic Eclipse", series: "Sun & Moon", releaseDate: "2019/11/01" },
  { id: "sm8", name: "Lost Thunder", series: "Sun & Moon", releaseDate: "2018/11/02" },
  { id: "sm7", name: "Celestial Storm", series: "Sun & Moon", releaseDate: "2018/08/03" },
  { id: "sm3", name: "Burning Shadows", series: "Sun & Moon", releaseDate: "2017/08/04" },
  { id: "sm1", name: "Sun & Moon", series: "Sun & Moon", releaseDate: "2017/02/03" },
  { id: "xy12", name: "Evolutions", series: "XY", releaseDate: "2016/11/02" },
  { id: "xy8", name: "BREAKthrough", series: "XY", releaseDate: "2015/11/04" },
  { id: "xy7", name: "Ancient Origins", series: "XY", releaseDate: "2015/08/12" },
  { id: "xy2", name: "Flashfire", series: "XY", releaseDate: "2014/05/07" },
  { id: "xy1", name: "XY", series: "XY", releaseDate: "2014/02/05" },
  { id: "bw11", name: "Legendary Treasures", series: "Black & White", releaseDate: "2013/11/06" },
  { id: "bw7", name: "Boundaries Crossed", series: "Black & White", releaseDate: "2012/11/07" },
  { id: "col1", name: "Call of Legends", series: "HeartGold SoulSilver", releaseDate: "2011/02/09" },
  { id: "base6", name: "Legendary Collection", series: "Other", releaseDate: "2002/05/24" },
  { id: "base3", name: "Fossil", series: "Base", releaseDate: "1999/10/10" },
  { id: "base2", name: "Jungle", series: "Base", releaseDate: "1999/06/16" },
  { id: "base1", name: "Base", series: "Base", releaseDate: "1999/01/09" },
];

/** One-click chips — current era, always visible above the typeahead. */
export const QUICK_SET_CHIPS: { id: string; label: string }[] = [
  { id: "me5", label: "Pitch Black" },
  { id: "me4", label: "Chaos Rising" },
  { id: "me3", label: "Perfect Order" },
  { id: "me2pt5", label: "Ascended Heroes" },
  { id: "me2", label: "Phantasmal" },
  { id: "me1", label: "Mega Evo" },
  { id: "sv8pt5", label: "Prismatic" },
  { id: "sv8", label: "Surging Sparks" },
  { id: "sv3pt5", label: "151" },
];

export function mergeSets(...lists: SetOption[][]): SetOption[] {
  const map = new Map<string, SetOption>();
  for (const list of lists) {
    for (const s of list) {
      if (!s?.id) continue;
      const prev = map.get(s.id);
      if (!prev) {
        map.set(s.id, s);
        continue;
      }
      // Prefer the row with the newer / more complete releaseDate + name.
      map.set(s.id, {
        id: s.id,
        name: s.name || prev.name,
        series: s.series || prev.series,
        releaseDate: s.releaseDate || prev.releaseDate,
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    (b.releaseDate || "").localeCompare(a.releaseDate || ""),
  );
}

export function filterSets(sets: SetOption[], query: string, limit = 40): SetOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return sets.slice(0, limit);
  const scored = sets
    .map((s) => {
      const name = s.name.toLowerCase();
      const series = s.series.toLowerCase();
      const id = s.id.toLowerCase();
      let score = 0;
      if (name === q || id === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (id.startsWith(q)) score = 70;
      else if (name.includes(q)) score = 50;
      else if (series.includes(q)) score = 30;
      else if (id.includes(q)) score = 20;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.s.releaseDate || "").localeCompare(a.s.releaseDate || ""));
  return scored.slice(0, limit).map((x) => x.s);
}

export function setLabel(s: SetOption): string {
  return s.series ? `${s.name} · ${s.series}` : s.name;
}
