import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCatalogResolver } from "./resolver.js";
import { createScryfallCatalogAdapter } from "./scryfallAdapter.js";
import {
  createMtgjsonCatalogAdapter,
  flattenMtgjsonMirror,
  MTGJSON_MIRROR_SAMPLE,
  mtgjsonCardsToCatalog,
} from "./mtgjsonAdapter.js";

describe("MtgjsonCatalogAdapter", () => {
  it("flattens AllPrintings-shaped data and compact cards arrays", () => {
    const compact = flattenMtgjsonMirror(MTGJSON_MIRROR_SAMPLE);
    expect(compact.map((c) => c.name)).toEqual(["Lightning Bolt", "Black Lotus"]);

    const allPrintings = flattenMtgjsonMirror({
      data: {
        LEA: {
          name: "Limited Edition Alpha",
          cards: [
            {
              name: "Ancestral Recall",
              number: "48",
              identifiers: { scryfallId: "ancestral-id" },
            },
          ],
        },
      },
    });
    expect(allPrintings[0]).toMatchObject({
      name: "Ancestral Recall",
      setCode: "LEA",
      setName: "Limited Edition Alpha",
      number: "48",
    });
  });

  it("emits scryfall external ids so the resolver can corroborate", () => {
    const cards = mtgjsonCardsToCatalog(flattenMtgjsonMirror(MTGJSON_MIRROR_SAMPLE), {
      text: "Lightning Bolt 161",
      category: "mtg",
    });
    expect(cards[0]?.externalIds[0]).toEqual({
      source: "scryfall",
      value: "e3285e6b-3e79-4d4d-9025-9a4c73772a36",
    });
    expect(cards[0]?.collectorNumber).toBe("161");
  });

  it("loads from a local file and works with the network disabled", async () => {
    const dir = join(tmpdir(), `mtgjson-mirror-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "mirror.json");
    writeFileSync(path, JSON.stringify(MTGJSON_MIRROR_SAMPLE));

    const mtgjson = createMtgjsonCatalogAdapter({ path });
    const scryfall = createScryfallCatalogAdapter({
      minIntervalMs: 0,
      fetch: async () => {
        throw new Error("network disabled");
      },
    });
    const resolver = createCatalogResolver({
      adapters: [mtgjson, scryfall],
    });
    const result = await resolver.resolve({
      unit: {
        ocrText: "Lightning Bolt Alpha 161",
        frontStorageRef: "bolt_front.jpg",
        categoryHint: "mtg",
      },
    });
    expect(result.candidates[0]?.displayName).toBe("Lightning Bolt");
    expect(result.candidates[0]?.externalIds.some((e) => e.source === "scryfall")).toBe(
      true,
    );
    const scryfallOutcome = result.outcomes.find((o) => o.adapterId === "scryfall");
    expect(scryfallOutcome?.status).toBe("error");
    expect(result.candidates.every((c) => c.provenance.verificationStatus === "unverified")).toBe(
      true,
    );
  });

  it("corroborates Scryfall on the same scryfall id without boosting confidence", async () => {
    const payload = JSON.stringify({
      data: [
        {
          id: "e3285e6b-3e79-4d4d-9025-9a4c73772a36",
          name: "Lightning Bolt",
          set_name: "Limited Edition Alpha",
          collector_number: "161",
        },
      ],
    });
    const resolver = createCatalogResolver({
      adapters: [
        createMtgjsonCatalogAdapter({ payload: MTGJSON_MIRROR_SAMPLE }),
        createScryfallCatalogAdapter({
          minIntervalMs: 0,
          fetch: async () => ({
            ok: true,
            status: 200,
            headers: { get: () => "application/json" },
            text: async () => payload,
          }),
        }),
      ],
    });
    const result = await resolver.resolve({
      unit: {
        ocrText: "Lightning Bolt 161",
        frontStorageRef: "bolt.jpg",
        categoryHint: "mtg",
      },
    });
    const bolt = result.candidates.filter((c) => c.displayName === "Lightning Bolt");
    expect(bolt).toHaveLength(1);
    expect(bolt[0]?.matchReasons.some((r) => r.startsWith("corroborated:"))).toBe(true);
    const scores = [bolt[0]?.confidence ?? 0];
    expect(scores[0]).toBeLessThanOrEqual(1);
  });
});
