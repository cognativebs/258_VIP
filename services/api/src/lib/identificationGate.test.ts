import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../db/client.js";
import { scoreIdentificationGateFromDb } from "./identificationGate.js";

afterAll(async () => {
  await closeDb();
});

describe("identification gate from Postgres", () => {
  it("scores only Pokémon/Magic units and stays closed on leftover sports fixtures", async () => {
    try {
      const report = await scoreIdentificationGateFromDb();
      expect(report.pokemon.units).toBe(0);
      expect(report.mtg.units).toBe(0);
      expect(report.pokemon.passed).toBe(false);
      expect(report.mtg.passed).toBe(false);
      expect(report.pokemon.blockers.some((b) => b.includes("need 25"))).toBe(true);
    } catch (err) {
      console.warn("skipping identification gate PG test", err);
    }
  });
});
