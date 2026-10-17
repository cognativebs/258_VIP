import { describe, expect, it } from "vitest";
import {
  briefFromRun,
  groupFor,
  listBriefs,
  runSignalsBrief,
  setThesisStatus,
  storeBrief,
  ThesisTransitionError,
  type FetchLike,
  type Queryable,
} from "./signalsDesk.js";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const T1 = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-10-17T12:00:00.000Z");

type Call = { text: string; params: unknown[] };

/** Records every statement; answers the few reads storeBrief makes. */
function recorder(opts: { existingClaim?: boolean; openThesis?: string } = {}) {
  const calls: Call[] = [];
  const db: Queryable = {
    query: async (text, params = []) => {
      calls.push({ text, params });
      if (text.includes("SELECT id, domain FROM vault_signals.signal")) {
        return { rows: [{ id: S1, domain: "collectibles" }, { id: S2, domain: "sports_cards" }] };
      }
      if (text.includes("SELECT id FROM vault_signals.thesis WHERE claim_key")) return { rows: opts.existingClaim ? [{ id: T1 }] : [] };
      if (text.includes("INSERT INTO vault_signals.thesis\n")) return { rows: [{ id: T1 }] };
      if (text.includes("INSERT INTO vault_signals.thesis_signal")) return { rows: [{ signal_id: params[1] }] };
      if (text.includes("UPDATE vault_signals.thesis SET updated_at")) return { rows: params[0] === opts.openThesis || params[0] === T1 ? [{ id: params[0] }] : [] };
      return { rows: [] };
    },
  };
  return { db, calls };
}

const output = {
  headline: "Delta Reign preorders open",
  summary: "Preorders opened at two outlets.",
  sections: [],
  theses: [
    { claim: "Delta Reign sealed sells out at MSRP within 30 days", horizon_days: 30, action: "Buy" as const, confidence: 0.9, reasons: ["two outlets"], signal_ids: [S1] },
    { claim: "A thesis resting on a signal outside the brief", horizon_days: 30, action: "Watch" as const, confidence: 0.4, reasons: ["x"], signal_ids: ["33333333-3333-4333-8333-333333333333"] },
  ],
  thesisUpdates: [{ thesis_id: "88888888-8888-4888-8888-888888888888", verdict: "weakened" as const, reason: "reprint" }],
  rejected: [],
};

describe("storeBrief", () => {
  it("stores a gated draft with its prediction and links, and rejects what fails the gate", async () => {
    const { db, calls } = recorder({ openThesis: "88888888-8888-4888-8888-888888888888" });
    const report = await storeBrief(db, "run_x", output, [{ signalId: S1, ref: "S1" }, { signalId: S2, ref: "S2" }], NOW);
    expect(report).toMatchObject({ created: 1, predictions: 1, linked: 1, reviewed: 1 });
    expect(report.rejected).toEqual([expect.stringMatching(/cites no signal/)]);

    const insert = calls.find((c) => c.text.includes("INSERT INTO vault_signals.thesis\n"))!;
    // Buy without market data is stored as Watch with Buy withheld; confidence capped.
    expect(insert.params[7]).toBe("Watch");
    expect(JSON.parse(String(insert.params[8]))).toEqual([{ action: "Buy", reason: expect.stringMatching(/sold comps/) }]);
    expect(insert.params[9]).toBe(0.75);
    expect(insert.params[4]).toBe("collectibles");
    const prediction = calls.find((c) => c.text.includes("INSERT INTO vault_signals.prediction"))!;
    expect(prediction.params).toEqual(expect.arrayContaining([T1, S1, 30]));
  });

  it("links new signals to an open thesis with the same claim instead of duplicating it", async () => {
    const { db, calls } = recorder({ existingClaim: true });
    const report = await storeBrief(db, "run_y", { ...output, theses: [output.theses[0]!], thesisUpdates: [] }, [{ signalId: S1 }], NOW);
    expect(report).toMatchObject({ created: 0, predictions: 0, reviewed: 1, linked: 1 });
    expect(calls.some((c) => c.text.includes("INSERT INTO vault_signals.thesis\n"))).toBe(false);
  });
});

describe("briefFromRun", () => {
  it("prefers the step whose JSON carries theses", () => {
    const b = briefFromRun({
      text: "final prose",
      trace: [
        { role: "thesis_manager", structured: { summary: "draft", theses: [], confidence: 0.5 } },
        { role: "synthesizer", structured: { summary: "final", confidence: 0.6 } },
      ],
    });
    expect(b?.summary).toBe("draft");
    expect(briefFromRun({ text: "only prose", trace: [{ role: "synthesizer", text: "only prose" }] })).toBeNull();
  });
});

describe("runSignalsBrief", () => {
  const PROFILE = {
    name: "daily-headlines",
    version: "0.1.0",
    schema: "vip_signals_curation_v1",
    domain: "macro",
    slots: 20,
    windowHours: 24,
    groups: [{ key: "us", label: "US news", lanes: ["us"], share: 1, stance: "collect" }],
    backfillOrder: ["us"],
    notes: "fixture",
  };
  const headline = {
    id: S1, title: "Tariff on imported trading cards", summary: "Proposed tariff.", direction: "down", first_seen_at: "2026-10-17T08:00:00Z",
    base_confidence: 0.5, base_impact: 0.4, noise_probability: 0.3, prov_method: "inferred", prov_verification: "unverified",
    code: "TRADE_POLICY", display_name: "Trade policy", influence: 0.4, source_id: "gdelt_doc_v2", feed_url: null,
    source_item_url: "https://example.com/tariff", source_name: "GDELT", storage_key: "snapshots/gdelt_doc_v2/us/x.json", subject: null,
  };
  function contextDb(withSignals: boolean): Queryable & { writes: string[] } {
    const writes: string[] = [];
    return {
      writes,
      query: async (text, params = []) => {
        if (/INSERT|UPDATE/.test(text)) writes.push(text);
        if (text.includes("signals_synthesis_profile")) throw new Error("no Pokémon profile in this stub");
        if (text.includes("signals_curation_profile")) {
          return { rows: params[0] === "daily-headlines" ? [{ version: "0.1.0", verified: false, domain: "macro", profile_json: PROFILE }] : [] };
        }
        if (text.includes("SELECT DISTINCT ON (s.id)")) return { rows: withSignals ? [headline] : [] };
        if (text.includes("SELECT id, domain FROM vault_signals.signal")) return { rows: [{ id: S1, domain: "macro" }] };
        if (text.includes("SELECT id FROM vault_signals.thesis WHERE claim_key")) return { rows: [] };
        if (text.includes("INSERT INTO vault_signals.thesis\n")) return { rows: [{ id: T1 }] };
        if (text.includes("INSERT INTO vault_signals.thesis_signal")) return { rows: [{ signal_id: S1 }] };
        return { rows: [] };
      },
    };
  }
  const answer = (json: unknown, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });

  it("skips without calling Orchestr8 when there are no signals", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      throw new Error("must not be called");
    };
    const r = await runSignalsBrief(contextDb(false), { orchestr8Url: "http://o8", fetchImpl, at: NOW });
    expect(r.status).toBe("skipped");
    expect(called).toBe(false);
  });

  it("reports an unreachable Orchestr8 as failed and writes nothing", async () => {
    const db = contextDb(true);
    const r = await runSignalsBrief(db, { orchestr8Url: "http://o8", fetchImpl: async () => { throw new Error("ECONNREFUSED"); }, at: NOW });
    expect(r).toMatchObject({ status: "failed", reason: expect.stringMatching(/ECONNREFUSED/) });
    expect(db.writes).toEqual([]);
  });

  it("sends the brief pipeline on the cheap model and stores the gated thesis", async () => {
    const db = contextDb(true);
    let sent: Record<string, any> = {};
    const fetchImpl: FetchLike = async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return answer({
        runId: "run_brief",
        usage: { costUsd: 0.004 },
        trace: [{ role: "synthesizer", structured: {
          headline: "Tariff risk for imported cards", summary: "A proposed tariff could raise sealed costs.", confidence: 0.5,
          // Cited by its short ref, as the brief question asks.
          theses: [{ claim: "Imported sealed product costs rise within 90 days", horizon_days: 90, action: "Watch", confidence: 0.4, reasons: ["tariff headline"], signal_refs: ["S1"] }],
        } }],
      });
    };
    const r = await runSignalsBrief(db, { orchestr8Url: "http://o8", fetchImpl, at: NOW });
    expect(r).toMatchObject({ status: "succeeded", runId: "run_brief", costUsd: 0.004, signals: 1, stored: { created: 1, predictions: 1, linked: 1 } });
    expect(sent.task).toBe("signals_brief");
    expect(sent.roles).toEqual(["signal_hunter", "thesis_manager", "critic", "synthesizer"]);
    expect(new Set(Object.values(sent.model_overrides))).toEqual(new Set(["gpt-4o-mini"]));
    expect(JSON.parse(sent.input.contextJson).signals[0]).toMatchObject({ ref: "S1", signalId: S1, group: "Headlines", url: "https://example.com/tariff" });
  });

  it("stores nothing from a paused run", async () => {
    const db = contextDb(true);
    const r = await runSignalsBrief(db, { orchestr8Url: "http://o8", fetchImpl: async () => answer({ runId: "run_p", paused: true }), at: NOW });
    expect(r.status).toBe("paused");
    expect(db.writes).toEqual([]);
  });
});

describe("listBriefs", () => {
  it("reads only signals_brief runs, newest first, and parses each brief", async () => {
    const fetchImpl: FetchLike = async (url) => {
      const json = url.endsWith("/v1/runs")
        ? {
            runs: [
              { run_id: "run_a", task: "signals_brief", created_at: "2026-10-16T12:00:00Z", costUsd: 0.002 },
              { run_id: "run_b", task: "general", created_at: "2026-10-17T12:00:00Z" },
              { run_id: "run_c", task: "signals_brief", created_at: "2026-10-17T11:00:00Z", costUsd: 0.003 },
            ],
          }
        : {
            final_text: "prose",
            provenance: { model_overrides: { synthesizer: "gpt-4o-mini" } },
            trace: [{ role: "synthesizer", structured: { headline: `H ${url.slice(-5)}`, summary: "S", confidence: 0.5, theses: [{}] } }],
          };
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
    };
    const briefs = await listBriefs({ orchestr8Url: "http://o8", fetchImpl });
    expect(briefs.map((b) => b.runId)).toEqual(["run_c", "run_a"]);
    expect(briefs[0]).toMatchObject({ headline: "H run_c", summary: "S", parsed: true, models: ["gpt-4o-mini"], thesesProposed: 0 });
  });
});

describe("setThesisStatus", () => {
  const db = (status: string): Queryable => ({
    query: async (text) => (text.startsWith("SELECT status") ? { rows: [{ status }] } : { rows: [{ id: T1, status: "active" }] }),
  });

  it("lets the operator activate a draft and refuses to reopen a retired thesis", async () => {
    await expect(setThesisStatus(db("draft"), T1, { status: "active" }, NOW)).resolves.toMatchObject({ status: "active" });
    await expect(setThesisStatus(db("retired"), T1, { status: "active" }, NOW)).rejects.toBeInstanceOf(ThesisTransitionError);
  });
});

describe("groupFor", () => {
  it("puts clusters under Pokémon and GDELT business under Markets", () => {
    expect(groupFor("collectibles", "pokebeach-cluster@0.1.0", "pokebeach_official")).toBe("Pokémon");
    expect(groupFor("macro", "headline-classifier@0.1.0", "business")).toBe("Markets");
    expect(groupFor("macro", "headline-classifier@0.1.0", "us")).toBe("Headlines");
    expect(groupFor("sports_cards", "sports-classifier@0.1.0", "nfl")).toBe("Sports");
  });
});
