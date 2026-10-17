import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { briefDue, loadBriefState, localDay, runSignalsBriefJob, type BriefState, type FetchLike } from "./signals-brief.js";

const at = (h: number) => new Date(2026, 9, 17, h, 5);
const fresh: BriefState = { day: null, attempts: 0, succeeded: false, spentUsd: 0, lastRunId: null, lastStatus: null, lastAt: null };
const opts = { hour: 7, capUsd: 1 };

describe("briefDue", () => {
  it("waits for the hour, runs once, and catches up later in the day", () => {
    expect(briefDue(fresh, at(6), opts)).toMatchObject({ run: false, reason: expect.stringMatching(/7:00/) });
    expect(briefDue(fresh, at(15), opts)).toEqual({ run: true });
    const done = { ...fresh, day: localDay(at(9)), succeeded: true, lastRunId: "run_a" };
    expect(briefDue(done, at(20), opts)).toMatchObject({ run: false, reason: expect.stringMatching(/done/) });
    // A new day resets the counters.
    expect(briefDue(done, new Date(2026, 9, 18, 8), opts)).toEqual({ run: true });
  });

  it("stops after three failed attempts and at the spend cap, even when forced", () => {
    const day = localDay(at(9));
    expect(briefDue({ ...fresh, day, attempts: 3 }, at(12), opts).run).toBe(false);
    expect(briefDue({ ...fresh, day, spentUsd: 1.2 }, at(12), { ...opts, force: true })).toMatchObject({ run: false, reason: expect.stringMatching(/cap/) });
  });
});

describe("runSignalsBriefJob", () => {
  const statePath = () => join(mkdtempSync(join(tmpdir(), "brief-")), "state.json");
  const api = (body: unknown): FetchLike => async () => ({ ok: true, status: 200, json: async () => body });

  it("records a successful brief and its spend so the day is done", async () => {
    const path = statePath();
    const r = await runSignalsBriefJob({ now: at(8), statePath: path, env: {}, fetchImpl: api({ status: "succeeded", runId: "run_x", costUsd: 0.004 }) });
    expect(r).toMatchObject({ ran: true, reason: "succeeded" });
    expect(loadBriefState(path)).toMatchObject({ succeeded: true, attempts: 1, spentUsd: 0.004, lastRunId: "run_x" });
    const again = await runSignalsBriefJob({ now: at(9), statePath: path, env: {}, fetchImpl: api({ status: "succeeded" }) });
    expect(again.ran).toBe(false);
  });

  it("leaves the day open when the API is down, for the next hourly retry", async () => {
    const path = statePath();
    const down: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const r = await runSignalsBriefJob({ now: at(8), statePath: path, env: {}, fetchImpl: down });
    expect(r.api).toMatchObject({ status: "failed", reason: expect.stringMatching(/unreachable/) });
    expect(loadBriefState(path)).toMatchObject({ succeeded: false, attempts: 1 });
  });

  it("counts a quiet day (no signals) as done", async () => {
    const path = statePath();
    await runSignalsBriefJob({ now: at(8), statePath: path, env: {}, fetchImpl: api({ status: "skipped", reason: "no signals in the last 24 hours" }) });
    expect(loadBriefState(path).succeeded).toBe(true);
  });
});
