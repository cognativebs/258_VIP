import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { comicsTerminalSourceLabel } from "./comicsSourceLabel";

describe("comicsTerminalSourceLabel", () => {
  it("labels a live Comics API as editable Postgres", () => {
    assert.equal(comicsTerminalSourceLabel("comics-api"), "Postgres live (editable)");
  });

  it("does not call VIP fallback read-only — edits go through VIP; inbox needs :5200", () => {
    const label = comicsTerminalSourceLabel("vip-api");
    assert.match(label, /editable/);
    assert.match(label, /5200/);
    assert.doesNotMatch(label, /read-only/i);
  });
});
