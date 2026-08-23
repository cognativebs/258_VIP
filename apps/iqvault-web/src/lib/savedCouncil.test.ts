import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { savedCouncilInputSchema } from "./savedCouncil";

describe("savedCouncilInputSchema", () => {
  it("accepts a named team with at least one role", () => {
    const parsed = savedCouncilInputSchema.parse({
      name: "Grading Board",
      agents: ["grading_advisor", "critic"],
      mode: "pipeline",
    });
    assert.equal(parsed.name, "Grading Board");
    assert.deepEqual(parsed.agents, ["grading_advisor", "critic"]);
  });

  it("rejects a team with no name or no roles", () => {
    assert.equal(
      savedCouncilInputSchema.safeParse({
        name: "G",
        agents: ["critic"],
        mode: "parallel",
      }).success,
      false,
    );
    assert.equal(
      savedCouncilInputSchema.safeParse({
        name: "Grading Board",
        agents: [],
        mode: "parallel",
      }).success,
      false,
    );
  });
});
