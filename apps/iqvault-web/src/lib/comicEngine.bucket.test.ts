import assert from "node:assert/strict";
import { test } from "node:test";
import { filterByWorkspace, formatCell } from "./comicEngine";

test("bucket workspaces split personal / invest / dealer", () => {
  const rows = [
    { id: "1", "Inventory Bucket": "personal_collection", "Current Price": 10 },
    { id: "2", "Inventory Bucket": "investment_vault", "Current Price": 20 },
    { id: "3", "Inventory Bucket": "dealer_inventory", "Sell Priority": "High", "Current Price": 5 },
  ];
  assert.deepEqual(
    filterByWorkspace(rows, "personal").map((r: { id: string }) => r.id),
    ["1"],
  );
  assert.deepEqual(
    filterByWorkspace(rows, "investment").map((r: { id: string }) => r.id),
    ["2"],
  );
  assert.deepEqual(
    filterByWorkspace(rows, "dealer").map((r: { id: string }) => r.id),
    ["3"],
  );
  assert.deepEqual(
    filterByWorkspace(rows, "sell").map((r: { id: string }) => r.id),
    ["3"],
  );
});

test("LIVE cell never copies VALUE and never says sold", () => {
  assert.equal(formatCell("Live Range", undefined), "not fetched");
  assert.equal(
    formatCell("Live Range", "$3.59–$3.98 · 6 listings · 19d · unverified"),
    "$3.59–$3.98 · 6 listings · 19d · unverified",
  );
  assert.equal(formatCell("Current Price", 46), "$46.00");
});
