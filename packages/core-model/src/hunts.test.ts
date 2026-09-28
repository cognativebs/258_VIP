import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HuntDefinitionSchema,
  HuntItemPatchSchema,
  HuntItemStatusSchema,
  priceBandFor,
  setProgress,
  type HuntPriceBand,
} from "./hunts.js";

const MIDNIGHT = JSON.parse(
  readFileSync(new URL("../../../data/hunts/marvel-midnight-universe.json", import.meta.url), "utf8"),
);

describe("hunt definition", () => {
  it("accepts the Midnight Universe definition: 20 targets, 4 trios, nothing guessed", () => {
    const def = HuntDefinitionSchema.parse(MIDNIGHT);
    expect(def.items).toHaveLength(20);
    expect(def.sets.map((s) => s.slug)).toEqual([
      "a-cloaked-trio",
      "b-stegman-trio",
      "d-horror-trio",
      "crain-connecting",
    ]);
    expect(def.sets.find((s) => s.slug === "crain-connecting")?.priority).toBe("critical");
    // Catalog facts the spec did not give stay null rather than invented.
    expect(def.items.every((i) => i.upc === null && i.releaseDate === null && i.coverImage === null)).toBe(true);
    expect(def.items.every((i) => i.printLimitVerified === null)).toBe(true);
    expect(def.source.verification).toBe("unverified");
  });

  it("rejects a set member or section that does not exist, and duplicate keys", () => {
    const broken = structuredClone(MIDNIGHT);
    broken.sets[0].members.push("msm-1-z");
    broken.items[0].section = "nowhere";
    broken.items[1].key = broken.items[2].key;
    const result = HuntDefinitionSchema.safeParse(broken);
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining(["unknown item msm-1-z", "unknown section nowhere", expect.stringMatching(/^duplicate key/)]),
    );
  });
});

describe("price bands", () => {
  const def = HuntDefinitionSchema.parse(MIDNIGHT);
  const bands = (key: string): HuntPriceBand[] => def.items.find((i) => i.key === key)!.priceBands;

  it("X-Men J: < $80 high priority, < $100 buy, $100–125 watch", () => {
    const j = bands("mxm-1-j");
    expect(priceBandFor(j, 79.99)).toBe("HIGH_PRIORITY");
    expect(priceBandFor(j, 80)).toBe("BUY");
    expect(priceBandFor(j, 99.99)).toBe("BUY");
    expect(priceBandFor(j, 100)).toBe("WATCH");
    expect(priceBandFor(j, 125)).toBe("WATCH");
    expect(priceBandFor(j, 125.01)).toBeNull();
  });

  it("Fantastic Four G: priority rises at ≤ $35, buy at ≤ $40", () => {
    const g = bands("mff-1-g");
    expect(priceBandFor(g, 35)).toBe("PRIORITY_UP");
    expect(priceBandFor(g, 36)).toBe("BUY");
    expect(priceBandFor(g, 40.01)).toBeNull();
  });

  it("E 1:25: ≤ $30 raw preferred", () => {
    expect(priceBandFor(bands("msm-1-e"), 30)).toBe("BUY");
    expect(priceBandFor(bands("msm-1-e"), 31)).toBeNull();
  });
});

describe("set progress and statuses", () => {
  it("counts owned members, sums what was paid, lists what is missing, ignores PASS", () => {
    const progress = setProgress([
      { name: "Spider-Man F", status: "owned", paid: 7.5 },
      { name: "Fantastic Four F", status: "ordered", paid: null },
      { name: "X-Men F", status: "target", paid: null },
      { name: "Excluded", status: "pass", paid: null },
    ]);
    expect(progress).toEqual({
      owned: 1,
      total: 3,
      completionPct: 33.3,
      totalPaid: 7.5,
      unpricedOwned: 0,
      missing: ["Fantastic Four F", "X-Men F"],
    });
  });

  it("accepts the lifecycle plus legacy statuses, and validates patches", () => {
    for (const s of ["target", "watching", "buy", "ordered", "owned", "pass", "wanted", "missing"]) {
      expect(HuntItemStatusSchema.parse(s)).toBe(s);
    }
    expect(HuntItemStatusSchema.safeParse("preorder").success).toBe(false);
    expect(HuntItemPatchSchema.safeParse({}).success).toBe(false);
    expect(HuntItemPatchSchema.safeParse({ status: "ordered", paid: 5.99 }).success).toBe(true);
    expect(HuntItemPatchSchema.safeParse({ paid: -1 }).success).toBe(false);
  });
});
