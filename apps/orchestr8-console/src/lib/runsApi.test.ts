import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRunDetail, parseRunListResponse } from "./orchestr8Api";

const LIST = {
  runs: [
    {
      run_id: "run_1",
      task: "comics_collection_analysis",
      question: "sell?",
      question_truncated: false,
      created_at: "2026-08-25T00:00:00Z",
      retrieved_at: "2026-08-25T00:00:01Z",
      costUsd: 0.1,
      vetoed: false,
      paused: false,
      extra_should_drop: "nope",
    },
  ],
  count: 1,
  retrieved_at: "2026-08-25T00:00:01Z",
  source: ".runs/",
};

describe("run list/detail zod", () => {
  it("parses a live GET /v1/runs payload", () => {
    const parsed = parseRunListResponse(LIST);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.runs[0]?.run_id, "run_1");
    assert.equal("extra_should_drop" in (parsed.runs[0] || {}), false);
  });

  it("throws a typed error on network-shaped garbage", () => {
    assert.throws(() => parseRunListResponse({ runs: "nope" }), /Run list failed schema/);
  });

  it("parses getRun by id and keeps extra bundle fields", () => {
    const detail = parseRunDetail({
      run_id: "run_1",
      final_text: "done",
      trace: [],
    });
    assert.equal(detail.run_id, "run_1");
    assert.equal(detail.final_text, "done");
  });

  it("rejects a detail payload with no run_id", () => {
    assert.throws(() => parseRunDetail({ task: "x" }), /Run detail failed schema/);
  });
});
