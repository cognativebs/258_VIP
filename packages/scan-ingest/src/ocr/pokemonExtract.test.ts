import { describe, expect, it } from "vitest";
import { extractPokemonFromOcr, looksLikePokemonOcr } from "./pokemonExtract.js";

/** Front OCR from Ricoh lot ed919c12 (2026-09-07 identification report). */
const RICO = {
  pikipek:
    "| rie ' :\ni > ds Fi sj\neee 0/3 | oodpecke: Cokemon ME |W 26 lbs al\nob Double Stab 10x\n_ Flip 2 coins. This attack does 10 damage for each heads.\n| weakness 4 x2? | resistance ) -30 a retreat *) es a4 a e .\nIllus. Koji Nakata j Pikipek has strong muscles in its neck, so itwon’t |\nA} PBL en : hurt itself even if it violently shakes its head. _\n% x a = ©2026 Pokémon / Nintendo / Creatures / GAME FREAK Se 2S 9",
  tauros:
    "NO..0128..Wild Bull. Pokémon,.HT;.4'7Z.\". WT..253.5.Jbs.\n©2025 Pokémon / Nintendo / Creatures / GAME FREAK",
  stadium:
    "Prevent all damage counters from being placed on Benched =\nPokémon (both yours and your opponent's) by effects of attacks =\nYou may play only | Stadium card during your turn.\nIllus. MARINA Chikazawa\n085/094 @\n©2025 Pokémon / Nintendo / Creatures / GAME FREAK",
  linoone:
    "eer Li iv 100 &\n== Linoone oo\nOnce during your turn, if this Pokémon is on your Bench,\nand if you have any Mega Evolution Pokémon @X in play,\nSlash 70\n(1 (PFLin} 082/094 @ winding paths is not its strong suit.\n©2025 Pokémon / Nintendo / Creatures/GAME FREAK",
  yamper:
    "NO..0835. Puppy Pokémon..HT..1'..WT:.29.8. lbs...\nPlay Rough 20+\n(DO} Prix) 030/094 @ Asitruns, itcrackles with electricity.\n©2025 Pokemon / Nintendo / Creatures / GAME FREAK",
  carvanha:
    "NO..0318 Savage Pokemon HT: 2'7\" WT: 45.9 |bs.\nIllus. Shin Nagasawa These Pokémon have sharp fangs and powerful a.\nSailors avoid Carvanhadensatallcosts.\n060/094 @\n©2025 Pokémon / Nintendo / Creatures / GAME FREAK",
  gloom:
    "NO. 0044 Weed Pokémon. HIL27\" WI 191s.\n@ Disperse Drool 20\n©2025 Pokémon / Nintendo / Creatures / GAME FREAK",
  sealeo:
    "ee 306\n@ * Bubble Drain 207\nHeal 20 damage from this Pokémon.\nIllus. svit The protrusion on its head is very hard. It\n0) rie) 021/094 © is used for bashing through thick ice.",
  energy: "_ Basic 6 Energy oe",
  jumbo: "Jumbo Ice Cream a\nHeal 80 damage from your Active Pokémon that has 3 or —\nmore Energy attached.",
  boltund:
    "= Boltund 130.4\nElectric Run 70+\n(1) it) 031/094 ©\n©2025 Pokemon / Nintendo / Creatures / GAME FREAK",
  buneary:
    "Buneary §— w/0%\nOK Run Around\nSwitch this Pokémon with | of your Benched Pokémon.\n083/094 ®\n©2025 Pokémon k smon / Nintendo / Creatures / GAME FREAK",
  brambleghast:
    "=Brambleghast ~.100©\nGZ Prison Panic\nPsychic Sphere 802\nGES 047/094 @\n62025 Pokemon, Nintendo / Creatures / GAME FREAK",
  archaludon:
    "NO..1018 Alloy Pokemon. HT..6'7.\".. WT: 132.3 lbs.\n(GED 075/004 @\n©2025 Pokémon / Nintendo / Creatures / GAME FREAK",
  lotad:
    "NO..0270..Water. Weed Pokémon. HT:.1'8\"..WT;.5.7 Ibs.\n©2025 Pokémon / Nintendo / Creatures / GAME FREAK",
  darumakaDex: "NO..0554. Zen. Charm, Pokémon. HT: 2'..WT..82.7 lbs.",
  volcarona:
    "> “Nolcarona /w 140 &\nO* Smoldering Scales 80\nIH] 029/159 @\n©2025 Pokémon / Nintendo / Creatures / GAME FREAK",
  brock: "_ Brock’s Scouting ;\n(GED 1426/1590 S\n©2025 Pokémon / Nintendo / Creatures /GAME FREAK",
  escavalier: "NO..0589_ Cavalry Pokémon. HT. 3'3 \"WT: 72,8 1DS\n*) Pierce 20\nHO xX» lron Buster 120",
  darumakaCard:
    "Darumaka wo\nRolling Tackle 20\n(1] 026/159 @\n©2025 Pokémon / Nintendo / Creatures / GAME FREAK",
  wailmer:
    "NO. 0320. Ball Whale Pokémon. HT: Bil. WT: 286.6 lbs.\nWK Surf 60\n©2025 Pokémon / Nintendo / Creatures / GAME FREAK",
  blackBelt:
    "Black Belt’s Training\nDuring this turn, attacks used by your Pokémon do 40 more\n©2025 Pokémon / Nintendo / Creatures / GAME FREAK",
  premium:
    "‘Premium Power Pro\n(1) Cs 124/132 ©\n02025 Pokémon / Nintendo / Creatures / GAME FREAK",
} as const;

describe("extractPokemonFromOcr", () => {
  it("reads species from lore and attack when the title is garbage", () => {
    const got = extractPokemonFromOcr(RICO.pikipek);
    expect(got.name).toBe("Pikipek");
    expect(looksLikePokemonOcr(RICO.pikipek)).toBe(true);
  });

  it("maps a pokedex NO. line when the species name is missing", () => {
    expect(extractPokemonFromOcr(RICO.tauros).name).toBe("Tauros");
    expect(extractPokemonFromOcr(RICO.lotad).name).toBe("Lotad");
    expect(extractPokemonFromOcr(RICO.darumakaDex).name).toBe("Darumaka");
    expect(extractPokemonFromOcr(RICO.escavalier).name).toBe("Escavalier");
    expect(extractPokemonFromOcr(RICO.escavalier).pokedexNumber).toBe(589);
    expect(extractPokemonFromOcr(RICO.wailmer).name).toBe("Wailmer");
    expect(extractPokemonFromOcr(RICO.archaludon).name).toBe("Archaludon");
  });

  it("lifts title species + collector NNN/NNN from noisy Ricoh lines", () => {
    const linoone = extractPokemonFromOcr(RICO.linoone);
    expect(linoone.name).toBe("Linoone");
    expect(linoone.collectorNumber).toBe("082/094");

    const yamper = extractPokemonFromOcr(RICO.yamper);
    expect(yamper.name).toBe("Yamper");
    expect(yamper.collectorNumber).toBe("030/094");

    const boltund = extractPokemonFromOcr(RICO.boltund);
    expect(boltund.name).toBe("Boltund");
    expect(boltund.collectorNumber).toBe("031/094");

    const buneary = extractPokemonFromOcr(RICO.buneary);
    expect(buneary.name).toBe("Buneary");
    expect(buneary.collectorNumber).toBe("083/094");

    const bramble = extractPokemonFromOcr(RICO.brambleghast);
    expect(bramble.name).toBe("Brambleghast");
    expect(bramble.collectorNumber).toBe("047/094");
  });

  it("recovers Carvanha from a glued flavor blob and Gloom from dex + attack", () => {
    expect(extractPokemonFromOcr(RICO.carvanha).name).toBe("Carvanha");
    expect(extractPokemonFromOcr(RICO.carvanha).collectorNumber).toBe("060/094");
    expect(extractPokemonFromOcr(RICO.gloom).name).toBe("Gloom");
    expect(extractPokemonFromOcr(RICO.sealeo).name).toBe("Seel");
    expect(extractPokemonFromOcr(RICO.sealeo).collectorNumber).toBe("021/094");
  });

  it("fuzzy-matches Nolcarona → Volcarona and keeps 029/159", () => {
    const got = extractPokemonFromOcr(RICO.volcarona);
    expect(got.name).toBe("Volcarona");
    expect(got.collectorNumber).toBe("029/159");
  });

  it("reads trainer / item titles instead of leftover sports tokens", () => {
    expect(extractPokemonFromOcr(RICO.jumbo).name).toBe("Jumbo Ice Cream");
    expect(extractPokemonFromOcr(RICO.brock).name).toBe("Brock's Scouting");
    expect(extractPokemonFromOcr(RICO.brock).collectorNumber).toBe("142/159");
    expect(extractPokemonFromOcr(RICO.blackBelt).name).toBe("Black Belt's Training");
    const premium = extractPokemonFromOcr(RICO.premium);
    expect(premium.name).toBe("Premium Power Pro");
    expect(premium.collectorNumber).toBe("124/132");
  });

  it("does not name Buneary as Switch from ability text", () => {
    expect(extractPokemonFromOcr(RICO.buneary).name).toBe("Buneary");
  });

  it("classifies basic energy and stadium + number", () => {
    expect(extractPokemonFromOcr(RICO.energy).name).toBe("Basic Energy");
    const stadium = extractPokemonFromOcr(RICO.stadium);
    expect(stadium.name).toBe("Battle Cage");
    expect(stadium.collectorNumber).toBe("085/094");
  });

  it("does not invent a name from sports biography OCR", () => {
    const got = extractPokemonFromOcr(
      "2021 Panini #0001 Houston Brought In Tyrod\nHouston brought in Tyrod Taylor to start the season",
    );
    expect(got.name).toBeNull();
    expect(looksLikePokemonOcr("2021 Panini Donruss Baker Mayfield")).toBe(false);
  });
});
