import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLLECTION_TABS,
  getCollectionTab,
  isCollectionTabId,
  workspaceChips,
} from "./collectionTabs.ts";

test("every collection tab parses and is live", () => {
  assert.equal(COLLECTION_TABS.length, 7);
  assert.ok(COLLECTION_TABS.every((t) => t.status === "live"));
  assert.ok(isCollectionTabId("pokemon"));
  assert.equal(isCollectionTabId("hockey"), false);
});

test("unknown id falls back to comics", () => {
  assert.equal(getCollectionTab("nope").id, "comic");
});

test("TCG workspaces become chip ids", () => {
  const chips = workspaceChips(getCollectionTab("pokemon"));
  assert.ok(chips.some((c) => c.id === "liq-move" && c.label === "LIQ MOVE"));
  assert.equal(workspaceChips(getCollectionTab("comic")).length, 0);
});
