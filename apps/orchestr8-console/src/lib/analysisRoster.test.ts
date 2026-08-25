import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analysisEffective } from "./councilSession";
import type { TeamSettings } from "./roles";

function team(partial: Partial<TeamSettings>): TeamSettings {
  return {
    presetId: "build_spec",
    roles: ["architect", "domain_expert", "tester", "critic"],
    mode: "pipeline",
    modelOverrides: {},
    council: "build_spec",
    ...partial,
  };
}

describe("analysisEffective honors AI team", () => {
  it("uses a custom 4-role combo instead of the 6-role Analysis default", () => {
    const roster = analysisEffective(
      team({
        presetId: "custom",
        council: null,
        mode: "parallel",
        roles: ["investment_analyst", "pricing_agent", "liquidity_analyst", "critic"],
      })
    );
    assert.deepEqual(roster.roles, [
      "investment_analyst",
      "pricing_agent",
      "liquidity_analyst",
      "critic",
    ]);
    assert.equal(roster.source, "team");
  });

  it("uses a saved named council (council_* preset) with four seats", () => {
    const roster = analysisEffective(
      team({
        presetId: "council_grading_board",
        council: "grading_board",
        mode: "parallel",
        roles: ["investment_analyst", "pricing_agent", "liquidity_analyst", "critic"],
      })
    );
    assert.equal(roster.councilId, "grading_board");
    assert.equal(roster.roles.length, 4);
    assert.equal(roster.source, "team");
  });
});
