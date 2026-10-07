import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeCall, jobHealth } from "./jobHealth";

describe("jobHealth", () => {
  const t0 = 1_000_000;

  it("waits briefly for the first heartbeat, then says the gateway may be old or stuck", () => {
    assert.equal(jobHealth({ now: t0 + 5_000, startedAt: t0, lastHeartbeatAt: null }).level, "connecting");
    const late = jobHealth({ now: t0 + 20_000, startedAt: t0, lastHeartbeatAt: null });
    assert.equal(late.level, "no_heartbeat");
    assert.match(late.text, /restart it/);
  });

  it("is healthy while heartbeats arrive, however long the model call takes", () => {
    assert.deepEqual(jobHealth({ now: t0 + 600_000, startedAt: t0, lastHeartbeatAt: t0 + 597_000 }), {
      level: "ok",
      text: "Healthy · gateway heartbeat 3s ago",
    });
  });

  it("flags a late heartbeat, then a silent gateway", () => {
    assert.equal(jobHealth({ now: t0 + 20_000, startedAt: t0, lastHeartbeatAt: t0 }).level, "slow");
    assert.equal(jobHealth({ now: t0 + 31_000, startedAt: t0, lastHeartbeatAt: t0 }).level, "silent");
  });
});

describe("describeCall", () => {
  it("names the role, model, wait and timeout, and counts retries", () => {
    const call = { role: "researcher", label: "Researcher", provider: "Anthropic", model: "Claude Sonnet", attempt: 2, timeoutS: 192, seconds: 40 };
    assert.equal(
      describeCall(call, 2.4),
      "Researcher · Anthropic Claude Sonnet · waiting on the model 42s (times out at 192s) · retry 1",
    );
  });
});
