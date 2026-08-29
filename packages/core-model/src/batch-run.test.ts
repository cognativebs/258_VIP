import { describe, expect, it } from "vitest";
import {
  InspectBatchItemBodySchema,
  MoneyFailureClassSchema,
  identityDisagrees,
} from "./batch-run.js";

describe("batch-run contracts", () => {
  it("accepts only money-affecting failure classes", () => {
    expect(MoneyFailureClassSchema.options).toEqual([
      "identity",
      "pricing",
      "inventory",
      "disposition",
      "listing",
      "workflow",
    ]);
  });

  it("flags a dropped parallel as an identity disagreement", () => {
    const notes = identityDisagrees(
      {
        year: 2023,
        brand: "Prizm",
        player: "Victor Wembanyama",
        collectorNumber: "136",
        parallel: "Silver",
        serialMax: null,
        autograph: false,
        relic: false,
        displayName: "2023 Prizm Victor Wembanyama #136 Silver",
      },
      {
        catalogKey: "sports:parsed:2023:prizm:victor-wembanyama:136",
        displayName: "2023 Prizm Victor Wembanyama #136",
        year: 2023,
        brand: "Prizm",
        player: "Victor Wembanyama",
        collectorNumber: "136",
        parallel: null,
        serialMax: null,
        autograph: false,
        relic: false,
        confidence: 0.62,
        matchReasons: ["year:2023", "brand:Prizm", "player:Victor Wembanyama"],
      },
    );
    expect(notes.some((n) => /parallel dropped/i.test(n))).toBe(true);
  });

  it("parses an inspect body with human seconds", () => {
    const body = InspectBatchItemBodySchema.parse({
      slot: 1,
      failureClasses: ["identity", "listing"],
      notes: "Silver parallel missing from title",
      humanSeconds: 42,
      inspector: "Gregory",
    });
    expect(body.humanSeconds).toBe(42);
  });
});
