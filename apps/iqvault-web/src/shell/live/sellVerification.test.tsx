import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleProvider } from "../role-context";
import { OperateView } from "../views/OperateView";
import { VerificationQueueView } from "../views/VerificationQueueView";
import type { OperateModel } from "./load";
import { sellModelFromResponse } from "./sell";
import { verificationModelFromResponse } from "./verification";

const provenance = {
  source: "ebay_sold",
  method: "recommendation",
  ruleOrModelVersion: "vip-sell-queue-dogfood@0.2.0+engine",
  confidence: 0.6,
  verificationStatus: "unverified",
  evidenceCount: 4,
  recencyDays: 6,
  minSalesRequired: 3,
};

const dogfood = {
  note: "Dogfood ranking",
  limit: 20,
  count: 2,
  gradingCost: { usd: 25, source: "default_assumption", note: "Default 25 USD per book is an assumption · unverified" },
  operatorMarks: "not_recorded",
  items: [
    {
      holdingId: "ranged",
      assetName: "Ranged book",
      sellPriority: "High",
      action: "Sell",
      confidence: 0.6,
      confidenceBand: "medium",
      reasons: ["Grading EV does not beat raw — liquidate candidate"],
      marketRange: { low: 40, high: 60, matchedSales: 4, recencyDays: 6, confidenceBand: "medium" },
      insufficientMarketEvidence: false,
      isStale: false,
      gradingRecommendation: "sell_raw",
      provenance,
    },
    {
      holdingId: "empty",
      assetName: "No comps book",
      sellPriority: null,
      action: "Hold",
      confidence: 0.2,
      confidenceBand: "low",
      reasons: ["Insufficient market evidence — evidence stale, do not treat as current"],
      marketRange: null,
      insufficientMarketEvidence: true,
      isStale: true,
      gradingRecommendation: "inspect_further",
      provenance: { ...provenance, evidenceCount: 0, recencyDays: null },
    },
  ],
};

describe("OPERATE → Sell dogfood list", () => {
  it("maps ranges only when there are comps and labels the grading-cost assumption", () => {
    const model = sellModelFromResponse(dogfood);
    assert.equal(model.error, null);
    assert.equal(model.items[0]?.range?.compCount, 4);
    assert.equal(model.items[1]?.range, null);
    assert.equal(model.items[1]?.insufficient, true);
    assert.match(model.assumption ?? "", /assumption · unverified/);
    assert.match(model.items[0]?.provenance ?? "", /4\/3 comps · 6d · unverified/);
  });

  it("renders action, confidence, reasons and insufficient evidence", () => {
    const operate: OperateModel = {
      sell: sellModelFromResponse(dogfood),
      listingsError: null,
      listings: [],
      transactionsError: null,
      transactions: [],
    };
    const html = renderToStaticMarkup(
      <RoleProvider initialRoleId="dealer">
        <OperateView model={operate} sectionId="sell" />
      </RoleProvider>,
    );
    assert.match(html, /data-action="Sell"/);
    assert.match(html, /60%/);
    assert.match(html, /\$40/);
    assert.match(html, /Insufficient market evidence/);
    assert.match(html, /liquidate candidate/);
    assert.match(html, /not recorded yet/);
  });

  it("reports a contract mismatch instead of rendering guesses", () => {
    const model = sellModelFromResponse({ items: [{ holdingId: "x" }] });
    assert.ok(model.error);
    assert.equal(model.items.length, 0);
  });
});

const queue = {
  available: true,
  error: null,
  ordering: "guide range high end desc",
  note: "Guide ranges are vendor guides (unverified).",
  counts: { ownedTotal: 2700, needsVerification: 2684, verified: 16, verifiedThisWeek: 3 },
  items: [
    {
      id: "h1",
      title: "Amazing Spider-Man #300",
      publisher: "Marvel",
      isKeyIssue: true,
      keyReason: "1st Venom",
      verificationNotes: null,
      guideRange: { low: 380, high: 410, sourceCount: 2, sources: ["covrprice", "pricecharting"], recencyDays: 12 },
      ageDays: 141,
      queuePosition: 1,
    },
    {
      id: "h2",
      title: "Unpriced #1",
      publisher: null,
      isKeyIssue: false,
      keyReason: null,
      verificationNotes: "Check variant",
      guideRange: null,
      ageDays: 141,
      queuePosition: 2,
    },
  ],
};

describe("VAULT → Needs review verification queue", () => {
  it("shows guide ranges as unverified low-confidence guides and a burn-down counter", () => {
    const model = verificationModelFromResponse(queue);
    assert.equal(model.items[0]?.range?.evidenceLabel, "guides");
    assert.equal(model.items[0]?.range?.confidence, "low");
    assert.equal(model.items[1]?.range, null);
    const html = renderToStaticMarkup(<VerificationQueueView model={model} onMark={async () => true} />);
    assert.match(html, /2,684/);
    assert.match(html, /2,700/);
    assert.match(html, /data-week="true">3</);
    assert.match(html, /No guide quote/);
    assert.match(html, />Verified</);
    assert.match(html, /Still needs review/);
    // One click per book: no bulk accept anywhere on the page.
    assert.doesNotMatch(html, /verify all|mark all|select all/i);
  });

  it("surfaces an unavailable queue as an error, not an empty success", () => {
    const model = verificationModelFromResponse({ ...queue, available: false, error: "db down", items: [] });
    assert.equal(model.error, "db down");
  });
});
