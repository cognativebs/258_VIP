/**
 * Signals Desk (operator decisions 2026-10-17): the daily Orchestr8 brief, the
 * theses it writes, the article feed, source health and prediction calibration.
 *
 * Brief: the four curated daily lists (operator slot shares) plus surfaced Pokémon
 * signals with their proposals go to an Orchestr8 pipeline (Signal Hunter → Thesis
 * Manager → Critic → Synthesizer). The run bundle stays in Orchestr8's immutable
 * .runs/; this module stores only what passes gateThesis, as draft · inferred ·
 * unverified, each linked to the signals it cites, with a prediction row so the
 * call can be measured. Verdicts on open theses are advisory (last_review).
 */
import { z } from "zod";
import {
  BRIEF_ROLES,
  BRIEF_TASK,
  BRIEF_VERSION,
  briefQuestion,
  calibrationSummary,
  gateThesis,
  parseBriefOutput,
  type BriefOutput,
  type BriefSignal,
  type OpenThesis,
} from "@vip/signals";
import { attributionFor, buildDaily, laneFor } from "./dailySports.js";
import { buildSynthesized } from "./synthesized.js";
import type { HuntForSignals } from "./signalExposure.js";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Connectable = Queryable & { connect?: () => Promise<Queryable & { release: () => void }> };
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export const DAILY_FOR_BRIEF = [
  { name: "daily-sports", group: "Sports", domain: "sports_cards" },
  { name: "daily-collectibles", group: "Collectibles", domain: "collectibles" },
  { name: "daily-headlines", group: "Headlines", domain: "macro" },
  { name: "daily-markets", group: "Markets", domain: "macro" },
] as const;
const BRIEF_PROV_SOURCE = "orchestr8:signals-brief";
const DEFAULT_BRIEF_MODEL = "gpt-4o-mini";
const ORCHESTR8_TIMEOUT_MS = 15 * 60 * 1000;
const POKEMON_BRIEF_DAYS = 7;

async function withTx<T>(db: Connectable, fn: (q: Queryable) => Promise<T>): Promise<T> {
  if (!db.connect) return fn(db);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Article feed

export const ArticlesQuerySchema = z
  .object({
    hours: z.coerce.number().int().min(1).max(24 * 30).optional(),
    domain: z.enum(["collectibles", "sports_cards", "macro"]).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export type SignalArticle = {
  signalId: string;
  group: string;
  domain: string;
  title: string;
  summary: string;
  type: string;
  typeName: string;
  direction: string;
  band: string | null;
  proposal: string | null;
  attribution: string;
  sourceKey: string;
  url: string | null;
  firstSeenAt: string;
  influence: number;
  confidence: number;
  independentSources: number;
  method: string;
  verification: string;
  thesisCount: number;
};

/** Desk group: Pokémon clusters, then the daily-list group the signal's lane belongs to. */
export function groupFor(domain: string, createdBy: string, lane: string): string {
  if (createdBy.startsWith("pokebeach-cluster@")) return "Pokémon";
  if (domain === "sports_cards") return "Sports";
  if (domain === "collectibles") return "Collectibles";
  if (domain === "macro") return lane === "business" ? "Markets" : "Headlines";
  return domain;
}

export async function signalArticles(
  db: Queryable,
  opts: { at?: Date; hours?: number; domain?: string; limit?: number; hunts?: ReadonlyArray<HuntForSignals> } = {},
): Promise<{ at: string; hours: number; articles: SignalArticle[] }> {
  const at = opts.at ?? new Date();
  const hours = opts.hours ?? 72;
  const { rows } = await db.query(
    `SELECT DISTINCT ON (s.id)
            s.id, s.domain, s.title, s.summary, s.direction, s.first_seen_at, s.created_by_version,
            s.base_confidence::float AS conf, s.prov_method::text AS method, s.prov_verification::text AS verification,
            t.code, t.display_name,
            vault_signals.signal_influence(s.id, $1)::float AS influence,
            vault_signals.independent_source_count(s.event_id) AS independent,
            d.source_id, d.source_url AS feed_url, ee.source_item_url, src.display_name AS source_name,
            (SELECT ds.storage_key FROM vault_signals.document_snapshot ds
              WHERE ds.raw_document_id = d.id ORDER BY ds.storage_key LIMIT 1) AS storage_key,
            (SELECT count(*) FROM vault_signals.thesis_signal ts WHERE ts.signal_id = s.id)::int AS thesis_count
       FROM vault_signals.signal s
       JOIN vault_signals.signal_type t ON t.id = s.signal_type_id
       JOIN vault_signals.event_evidence ee ON ee.event_id = s.event_id AND ee.role = 'PRIMARY'
       JOIN vault_signals.raw_document d ON d.id = ee.raw_document_id
       LEFT JOIN vault_core.signals_news_source src ON src.source_key = d.source_id
      WHERE s.first_seen_at <= $1
        AND s.first_seen_at > $1 - make_interval(hours => $2)
        AND ($3::text IS NULL OR s.domain = $3)
      ORDER BY s.id, ee.detected_at`,
    [at.toISOString(), hours, opts.domain ?? null],
  );

  // Pokémon clusters carry a read-time band and a proposal; noise stays listed but marked.
  const pokemon = new Map<string, { band: string; proposal: string }>();
  if (rows.some((r) => String(r.created_by_version).startsWith("pokebeach-cluster@"))) {
    const s = await buildSynthesized(db, { at, includeNoise: true, hunts: opts.hunts }).catch(() => null);
    for (const x of s?.signals ?? []) pokemon.set(x.signalId, { band: x.band, proposal: x.proposal.action });
  }

  const articles = rows
    .map((r): SignalArticle => {
      const p = pokemon.get(r.id);
      return {
        signalId: r.id,
        group: groupFor(r.domain, String(r.created_by_version), laneFor(r.source_id, r.storage_key, r.feed_url)),
        domain: r.domain,
        title: r.title,
        summary: r.summary,
        type: r.code,
        typeName: r.display_name,
        direction: r.direction,
        band: p?.band ?? null,
        proposal: p?.proposal ?? null,
        attribution: attributionFor(r.source_id, r.source_name, r.source_item_url),
        sourceKey: r.source_id,
        url: r.source_item_url,
        firstSeenAt: new Date(r.first_seen_at).toISOString(),
        influence: Number(r.influence ?? 0),
        confidence: Number(r.conf),
        independentSources: Number(r.independent ?? 0),
        method: r.method,
        verification: r.verification,
        thesisCount: Number(r.thesis_count ?? 0),
      };
    })
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
    .slice(0, opts.limit ?? 200);
  return { at: at.toISOString(), hours, articles };
}

// ---------------------------------------------------------------------------
// Brief context and run

export async function loadOpenTheses(db: Queryable): Promise<OpenThesis[]> {
  const { rows } = await db.query(
    `SELECT id, claim, action, status, horizon_days, created_at FROM vault_signals.thesis
      WHERE status IN ('draft', 'active') ORDER BY (status = 'active') DESC, updated_at DESC LIMIT 40`,
  );
  return rows.map((r) => ({
    id: r.id,
    claim: r.claim,
    action: r.action,
    status: r.status,
    horizonDays: Number(r.horizon_days),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** The curated daily lists (operator slot shares) plus surfaced Pokémon signals; Pokémon wins on overlap. */
export async function buildBriefContext(
  db: Queryable,
  opts: { at?: Date; hunts?: ReadonlyArray<HuntForSignals> } = {},
): Promise<{ windowHours: number; signals: BriefSignal[]; openTheses: OpenThesis[]; notes: string[] }> {
  const at = opts.at ?? new Date();
  const bySignal = new Map<string, BriefSignal>();
  const notes: string[] = [];
  let windowHours = 24;

  const synth = await buildSynthesized(db, { at, hunts: opts.hunts }).catch((e) => {
    notes.push(`Pokémon synthesis unavailable: ${e instanceof Error ? e.message : e}`);
    return null;
  });
  // Surfaced clusters decay slowly; only ones updated this week go in, so a brief does not repeat September.
  const pokemonSince = at.getTime() - POKEMON_BRIEF_DAYS * 86_400_000;
  for (const s of synth?.signals ?? []) {
    if (new Date(s.lastUpdatedAt).getTime() < pokemonSince) continue;
    const lead = s.evidence.find((e) => e.role === "PRIMARY") ?? s.evidence[0];
    bySignal.set(s.signalId, {
      ref: "S0",
      signalId: s.signalId,
      group: "Pokémon",
      domain: "collectibles",
      title: s.title,
      summary: `${s.themeName}; ${s.independentSourceCount} independent source(s); ${s.proposal.reasons.join("; ")}`,
      type: s.theme,
      direction: s.direction,
      band: s.band,
      attribution: lead?.outlet ?? "PokéBeach",
      url: lead?.url ?? null,
      firstSeenAt: s.firstSeenAt,
      confidence: s.scores.baseConfidence,
      method: s.method,
      proposal: `${s.proposal.action}${s.proposal.withheld.length ? `; withheld ${s.proposal.withheld.map((w) => w.action).join(", ")}` : ""}`,
      exposure: `owned ${s.exposure.owned}, wishlist ${s.exposure.wishlist}, hunts ${s.exposure.hunts.join(", ") || "none"}`,
    });
  }

  for (const list of DAILY_FOR_BRIEF) {
    const daily = await buildDaily(db, list.name, at).catch((e) => {
      notes.push(`${list.name} unavailable: ${e instanceof Error ? e.message : e}`);
      return null;
    });
    if (!daily) continue;
    windowHours = Math.max(windowHours, Number((daily.profile as { windowHours?: number }).windowHours ?? 24));
    for (const item of daily.items as Array<Record<string, any>>) {
      if (bySignal.has(item.signalId)) continue;
      bySignal.set(item.signalId, {
        ref: "S0",
        signalId: item.signalId,
        group: list.group,
        domain: list.domain,
        title: item.title,
        summary: item.summary ?? "",
        type: item.signalTypeName ?? item.signalType ?? "signal",
        direction: item.direction ?? "mixed",
        band: null,
        attribution: item.attribution ?? "unknown",
        url: item.sourceUrl ?? null,
        firstSeenAt: item.firstSeenAt ?? at.toISOString(),
        confidence: Number(item.baseConfidence ?? 0),
        method: item.method ?? "inferred",
        proposal: item.framing === "sell_window" ? "sell-window framing (exit sport)" : null,
        exposure: null,
      });
    }
  }
  const signals = [...bySignal.values()].map((s, i) => ({ ...s, ref: `S${i + 1}` }));
  return { windowHours, signals, openTheses: await loadOpenTheses(db), notes };
}

type Orchestr8Result = {
  text?: string;
  runId?: string;
  paused?: boolean;
  usage?: { costUsd?: number };
  trace?: Array<{ role?: string; structured?: Record<string, unknown> | null; text?: string }>;
  error?: string;
};

/** The synthesizer speaks last; fall back to any step whose JSON carries theses or a summary. */
export function briefFromRun(result: Pick<Orchestr8Result, "text" | "trace">): BriefOutput | null {
  const steps = [...(result.trace ?? [])].reverse();
  const withTheses = steps.find((s) => s.structured && Array.isArray((s.structured as { theses?: unknown }).theses));
  const last = steps.find((s) => s.structured);
  const pick = withTheses ?? last;
  return parseBriefOutput(pick?.structured ?? null, pick?.text ?? result.text ?? "");
}

export type StoreReport = { created: number; linked: number; reviewed: number; predictions: number; rejected: string[] };

/** Gate and store a brief's theses in one transaction. */
export async function storeBrief(
  db: Connectable,
  runId: string,
  output: BriefOutput,
  briefSignals: ReadonlyArray<{ signalId: string; ref?: string }>,
  now: Date = new Date(),
): Promise<StoreReport> {
  const report: StoreReport = { created: 0, linked: 0, reviewed: 0, predictions: 0, rejected: output.rejected.map((r) => `${r.kind}: ${r.issue}`) };
  return withTx(db, async (q) => {
    // Domains come from the database, so a model cannot relabel a signal.
    const { rows: known } = await q.query(`SELECT id, domain FROM vault_signals.signal WHERE id = ANY($1::uuid[])`, [briefSignals.map((s) => s.signalId)]);
    const refOf = new Map(briefSignals.map((s) => [s.signalId.toLowerCase(), s.ref]));
    const signals = known.map((r) => ({ signalId: String(r.id), domain: String(r.domain), ref: refOf.get(String(r.id).toLowerCase()) }));

    for (const c of output.theses) {
      const gate = gateThesis(c, signals);
      if (!gate.ok) {
        report.rejected.push(`thesis: ${gate.reason}`);
        continue;
      }
      const d = gate.draft;
      const existing = await q.query(
        `SELECT id FROM vault_signals.thesis WHERE claim_key = $1 AND status IN ('draft', 'active')`,
        [d.claimKey],
      );
      let thesisId: string;
      if (existing.rows[0]) {
        thesisId = existing.rows[0].id;
        await q.query(
          `UPDATE vault_signals.thesis SET updated_at = $2,
                  last_review = jsonb_build_object('runId', $3::text, 'verdict', 'holds', 'reason', 'Orchestr8 restated this thesis', 'at', $2::text)
            WHERE id = $1`,
          [thesisId, now.toISOString(), runId],
        );
        report.reviewed += 1;
      } else {
        const ins = await q.query(
          `INSERT INTO vault_signals.thesis
             (created_at, updated_at, created_by, claim, claim_key, domain, subject_refs, horizon_days, action, withheld,
              confidence, reasons, orchestr8_run_id, prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes)
           VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $2, 'inferred', $13, $10, 'unverified', $14)
           RETURNING id`,
          [
            now.toISOString(),
            BRIEF_PROV_SOURCE,
            d.claim,
            d.claimKey,
            d.domain,
            d.subjectRefs,
            d.horizonDays,
            d.action,
            JSON.stringify(d.withheld),
            d.confidence,
            d.reasons,
            runId,
            BRIEF_VERSION,
            "Draft from the daily Orchestr8 brief · inferred · unverified. Only the operator activates it.",
          ],
        );
        thesisId = ins.rows[0].id;
        report.created += 1;
        await q.query(
          `INSERT INTO vault_signals.prediction
             (created_at, created_by, subject_ref, subject_kind, claim_text, confidence, horizon_days, expires_at,
              source_signal_id, source_thesis_ref, prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes)
           VALUES ($1, $2, $3, 'thesis', $4, $5, $6, $1::timestamptz + make_interval(days => $6), $7, $8, $2, 'inferred', $9, $5, 'unverified', $10)`,
          [
            now.toISOString(),
            BRIEF_PROV_SOURCE,
            d.subjectRefs[0] ?? `thesis:${thesisId}`,
            d.claim,
            d.confidence,
            d.horizonDays,
            d.signalIds[0],
            thesisId,
            BRIEF_VERSION,
            `Measures thesis ${thesisId}: did the claim hold at each scoring date?`,
          ],
        );
        report.predictions += 1;
      }
      for (const signalId of d.signalIds) {
        const r = await q.query(
          `INSERT INTO vault_signals.thesis_signal (thesis_id, signal_id, linked_at, linked_by)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING signal_id`,
          [thesisId, signalId, now.toISOString(), `orchestr8:${runId}`],
        );
        report.linked += r.rows.length;
      }
    }

    for (const u of output.thesisUpdates) {
      const r = await q.query(
        `UPDATE vault_signals.thesis SET updated_at = $2,
                last_review = jsonb_build_object('runId', $3::text, 'verdict', $4::text, 'reason', $5::text, 'at', $2::text)
          WHERE id = $1 AND status IN ('draft', 'active') RETURNING id`,
        [u.thesis_id, now.toISOString(), runId, u.verdict, u.reason],
      );
      if (r.rows.length) report.reviewed += 1;
      else report.rejected.push(`thesis_update: ${u.thesis_id} is not an open thesis`);
    }
    return report;
  });
}

export type BriefRunReport =
  | { status: "skipped"; reason: string }
  | { status: "dry_run"; question: string; context: Awaited<ReturnType<typeof buildBriefContext>> }
  | { status: "failed" | "paused" | "unparsed"; reason: string; runId: string | null; costUsd: number }
  | { status: "succeeded"; runId: string; costUsd: number; headline: string; signals: number; stored: StoreReport };

let briefInFlight = false;
export const briefRunning = () => briefInFlight;

export async function runSignalsBrief(
  db: Connectable,
  opts: {
    orchestr8Url: string;
    fetchImpl?: FetchLike;
    at?: Date;
    model?: string;
    dryRun?: boolean;
    hunts?: ReadonlyArray<HuntForSignals>;
  },
): Promise<BriefRunReport> {
  if (briefInFlight) return { status: "skipped", reason: "a brief is already running" };
  briefInFlight = true;
  try {
    const at = opts.at ?? new Date();
    const ctx = await buildBriefContext(db, { at, hunts: opts.hunts });
    if (!ctx.signals.length) return { status: "skipped", reason: `no signals in the last ${ctx.windowHours} hours${ctx.notes.length ? ` (${ctx.notes.join("; ")})` : ""}` };
    const question = briefQuestion({ windowHours: ctx.windowHours, signalCount: ctx.signals.length, openTheses: ctx.openTheses.length, now: at });
    if (opts.dryRun) return { status: "dry_run", question, context: ctx };

    const model = opts.model ?? DEFAULT_BRIEF_MODEL;
    const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
    let result: Orchestr8Result;
    try {
      const res = await fetchImpl(`${opts.orchestr8Url.replace(/\/$/, "")}/v1/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: BRIEF_TASK,
          roles: [...BRIEF_ROLES],
          mode: "pipeline",
          input: {
            question,
            contextJson: JSON.stringify({ briefVersion: BRIEF_VERSION, signals: ctx.signals, openTheses: ctx.openTheses, notes: ctx.notes }),
          },
          model_overrides: Object.fromEntries(BRIEF_ROLES.map((r) => [r, model])),
        }),
        signal: AbortSignal.timeout(ORCHESTR8_TIMEOUT_MS),
      });
      result = (await res.json()) as Orchestr8Result;
      if (!res.ok) return { status: "failed", reason: `Orchestr8 answered ${res.status}: ${result.error ?? "error"}`, runId: null, costUsd: 0 };
    } catch (e) {
      return { status: "failed", reason: `Orchestr8 unreachable at ${opts.orchestr8Url}: ${e instanceof Error ? e.message : e}`, runId: null, costUsd: 0 };
    }
    const runId = result.runId ?? null;
    const costUsd = Number(result.usage?.costUsd ?? 0);
    if (result.paused) return { status: "paused", reason: "Orchestr8 paused the run (provider credit); resume it from the console", runId, costUsd };
    const output = briefFromRun(result);
    if (!output || !runId) {
      return { status: "unparsed", reason: runId ? "the final step returned no JSON summary" : "Orchestr8 did not persist the run", runId, costUsd };
    }
    const stored = await storeBrief(db, runId, output, ctx.signals, at);
    return { status: "succeeded", runId, costUsd, headline: output.headline, signals: ctx.signals.length, stored };
  } finally {
    briefInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Briefs (read from Orchestr8's run store)

export type BriefSummary = {
  runId: string;
  createdAt: string;
  costUsd: number;
  vetoed: boolean;
  headline: string | null;
  summary: string | null;
  sections: { group: string; points: string[] }[];
  thesesProposed: number;
  verdicts: { thesisId: string; verdict: string; reason: string }[];
  models: string[];
  parsed: boolean;
};

export async function listBriefs(opts: { orchestr8Url: string; fetchImpl?: FetchLike; limit?: number }): Promise<BriefSummary[]> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const base = opts.orchestr8Url.replace(/\/$/, "");
  const res = await fetchImpl(`${base}/v1/runs`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Orchestr8 /v1/runs answered ${res.status}`);
  const body = (await res.json()) as { runs?: Array<{ run_id: string; task: string; created_at: string; costUsd?: number; vetoed?: boolean }> };
  const runs = (body.runs ?? [])
    .filter((r) => r.task === BRIEF_TASK)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, opts.limit ?? 10);
  return Promise.all(
    runs.map(async (r): Promise<BriefSummary> => {
      const one = await fetchImpl(`${base}/v1/runs/${encodeURIComponent(r.run_id)}`, { signal: AbortSignal.timeout(8000) })
        .then((x) => (x.ok ? (x.json() as Promise<Record<string, any>>) : null))
        .catch(() => null);
      const brief = one ? briefFromRun({ text: one.final_text, trace: one.trace }) : null;
      return {
        runId: r.run_id,
        createdAt: r.created_at,
        costUsd: Number(r.costUsd ?? 0),
        vetoed: Boolean(r.vetoed),
        headline: brief?.headline ?? null,
        summary: brief?.summary ?? (one?.final_text as string | undefined) ?? null,
        sections: brief?.sections ?? [],
        thesesProposed: brief?.theses.length ?? 0,
        verdicts: (brief?.thesisUpdates ?? []).map((u) => ({ thesisId: u.thesis_id, verdict: u.verdict, reason: u.reason })),
        models: [...new Set(Object.values((one?.provenance?.model_overrides ?? {}) as Record<string, string>))],
        parsed: Boolean(brief),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Theses

export const ThesisStatusPatchSchema = z
  .object({
    status: z.enum(["active", "retired", "invalidated"]),
    note: z.string().trim().max(600).optional(),
  })
  .strict();

const ALLOWED_FROM: Record<string, string[]> = { draft: ["active", "retired", "invalidated"], active: ["retired", "invalidated"] };

export async function listTheses(db: Queryable, opts: { status?: string } = {}) {
  const { rows } = await db.query(
    `SELECT t.id, t.created_at, t.updated_at, t.created_by, t.claim, t.domain, t.subject_refs, t.horizon_days, t.action, t.withheld,
            t.confidence::float AS confidence, t.reasons, t.status, t.status_changed_at, t.status_changed_by, t.status_note,
            t.orchestr8_run_id, t.last_review, t.prov_method::text AS method, t.prov_verification::text AS verification, t.prov_rule_version,
            coalesce((SELECT json_agg(json_build_object(
                       'signalId', s.id, 'title', s.title, 'domain', s.domain, 'firstSeenAt', s.first_seen_at,
                       'url', (SELECT ee.source_item_url FROM vault_signals.event_evidence ee
                                WHERE ee.event_id = s.event_id AND ee.role = 'PRIMARY' ORDER BY ee.detected_at LIMIT 1))
                       ORDER BY s.first_seen_at DESC)
                       FROM vault_signals.thesis_signal ts JOIN vault_signals.signal s ON s.id = ts.signal_id
                      WHERE ts.thesis_id = t.id), '[]'::json) AS signals
       FROM vault_signals.thesis t
      WHERE ($1::text IS NULL OR t.status = $1)
      ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, t.updated_at DESC
      LIMIT 200`,
    [opts.status ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    createdBy: r.created_by,
    claim: r.claim,
    domain: r.domain,
    subjects: r.subject_refs ?? [],
    horizonDays: Number(r.horizon_days),
    expiresAt: new Date(new Date(r.created_at).getTime() + Number(r.horizon_days) * 86_400_000).toISOString(),
    action: r.action,
    withheld: r.withheld ?? [],
    confidence: Number(r.confidence),
    reasons: r.reasons ?? [],
    status: r.status,
    statusChangedAt: r.status_changed_at ? new Date(r.status_changed_at).toISOString() : null,
    statusChangedBy: r.status_changed_by,
    statusNote: r.status_note,
    orchestr8RunId: r.orchestr8_run_id,
    lastReview: r.last_review ?? null,
    provenance: { method: r.method, verification: r.verification, ruleVersion: r.prov_rule_version },
    signals: (r.signals ?? []) as Array<{ signalId: string; title: string; domain: string; url: string | null; firstSeenAt: string }>,
  }));
}

export class ThesisTransitionError extends Error {}

export async function setThesisStatus(db: Queryable, id: string, patch: z.infer<typeof ThesisStatusPatchSchema>, now: Date = new Date()) {
  const cur = await db.query(`SELECT status FROM vault_signals.thesis WHERE id = $1`, [id]);
  if (!cur.rows[0]) return null;
  const from = String(cur.rows[0].status);
  if (!(ALLOWED_FROM[from] ?? []).includes(patch.status)) {
    throw new ThesisTransitionError(`a ${from} thesis cannot become ${patch.status}`);
  }
  const { rows } = await db.query(
    `UPDATE vault_signals.thesis
        SET status = $2, status_changed_at = $3, status_changed_by = 'operator', status_note = $4, updated_at = $3
      WHERE id = $1 AND status = $5
      RETURNING id, status`,
    [id, patch.status, now.toISOString(), patch.note ?? null, from],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Predictions + calibration

export const MeasurementPatchSchema = z
  .object({ directionCorrect: z.boolean(), notes: z.string().trim().max(600).optional() })
  .strict();

export async function listPredictions(db: Queryable, now: Date = new Date()) {
  const { rows } = await db.query(
    `SELECT p.id, p.created_at, p.created_by, p.subject_ref, p.claim_text, p.confidence::float AS confidence, p.horizon_days,
            p.expires_at, p.status, p.source_signal_id, p.source_thesis_ref,
            coalesce(json_agg(json_build_object('id', m.id, 'dueAt', m.due_at, 'measuredAt', m.measured_at,
                       'directionCorrect', m.direction_correct, 'notes', m.notes) ORDER BY m.due_at)
                     FILTER (WHERE m.id IS NOT NULL), '[]'::json) AS measurements
       FROM vault_signals.prediction p
       LEFT JOIN vault_signals.prediction_measurement m ON m.prediction_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT 300`,
  );
  const predictions = rows.map((r) => ({
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by,
    subject: r.subject_ref,
    claim: r.claim_text,
    confidence: Number(r.confidence),
    horizonDays: Number(r.horizon_days),
    expiresAt: new Date(r.expires_at).toISOString(),
    status: r.status,
    signalId: r.source_signal_id,
    thesisId: r.source_thesis_ref,
    measurements: (r.measurements ?? []) as Array<{ id: string; dueAt: string; measuredAt: string | null; directionCorrect: boolean | null; notes: string | null }>,
  }));
  const calls = predictions.flatMap((p) =>
    p.measurements.filter((m) => m.measuredAt).map((m) => ({ confidence: p.confidence, directionCorrect: m.directionCorrect })),
  );
  const due = predictions.flatMap((p) =>
    p.measurements
      .filter((m) => !m.measuredAt && new Date(m.dueAt) <= now)
      .map((m) => ({ measurementId: m.id, predictionId: p.id, claim: p.claim, confidence: p.confidence, dueAt: new Date(m.dueAt).toISOString() })),
  );
  return { predictions, due, calibration: calibrationSummary(calls) };
}

export async function measurePrediction(db: Queryable, measurementId: string, patch: z.infer<typeof MeasurementPatchSchema>, now: Date = new Date()) {
  const { rows } = await db.query(
    `UPDATE vault_signals.prediction_measurement
        SET measured_at = $2, direction_correct = $3, notes = $4
      WHERE id = $1 AND measured_at IS NULL AND due_at <= $2
      RETURNING id`,
    [measurementId, now.toISOString(), patch.directionCorrect, patch.notes ?? "operator: did the claim hold at this date?"],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Source health

export async function signalsHealth(db: Queryable, now: Date = new Date()) {
  const { rows } = await db.query(
    `SELECT s.source_key, s.display_name, s.adapter_enabled, s.is_active, s.blocked_reason, s.cadence,
            (SELECT row_to_json(x) FROM (SELECT status, started_at, finished_at, documents_fetched, documents_new, error_text
               FROM vault_signals.ingest_run r WHERE r.source_id = s.source_key ORDER BY started_at DESC LIMIT 1) x) AS last_run,
            (SELECT max(started_at) FROM vault_signals.ingest_run r WHERE r.source_id = s.source_key AND r.status = 'succeeded') AS last_success,
            (SELECT max(f.consecutive_failures) FROM vault_signals.source_fetch_state f WHERE f.source_id = s.source_key) AS failures,
            (SELECT max(f.next_attempt_at) FROM vault_signals.source_fetch_state f WHERE f.source_id = s.source_key) AS next_attempt,
            (SELECT max(f.last_status) FILTER (WHERE f.consecutive_failures > 0) FROM vault_signals.source_fetch_state f WHERE f.source_id = s.source_key) AS failing_status,
            (SELECT max(sig.first_seen_at) FROM vault_signals.signal sig
               JOIN vault_signals.event_evidence ee ON ee.event_id = sig.event_id AND ee.role = 'PRIMARY'
               JOIN vault_signals.raw_document d ON d.id = ee.raw_document_id
              WHERE d.source_id = s.source_key) AS last_signal
       FROM vault_core.signals_news_source s
      ORDER BY (s.adapter_enabled AND s.is_active) DESC, s.source_key`,
  );
  const sources = rows.map((r) => {
    const enabled = Boolean(r.adapter_enabled && r.is_active);
    const lastSuccess = r.last_success ? new Date(r.last_success) : null;
    const staleHours = lastSuccess ? Math.round((now.getTime() - lastSuccess.getTime()) / 3_600_000) : null;
    const state = !enabled
      ? "off"
      : r.blocked_reason
        ? "blocked"
        : Number(r.failures ?? 0) > 0
          ? "failing"
          : staleHours === null || staleHours > 6
            ? "stale"
            : "ok";
    return {
      sourceKey: r.source_key,
      name: r.display_name,
      enabled,
      state,
      blockedReason: r.blocked_reason,
      cadence: r.cadence,
      lastRun: r.last_run,
      lastSuccessAt: lastSuccess?.toISOString() ?? null,
      hoursSinceSuccess: staleHours,
      consecutiveFailures: Number(r.failures ?? 0),
      failingStatus: r.failing_status === null || r.failing_status === undefined ? null : Number(r.failing_status),
      nextAttemptAt: r.next_attempt ? new Date(r.next_attempt).toISOString() : null,
      lastSignalAt: r.last_signal ? new Date(r.last_signal).toISOString() : null,
    };
  });
  const enabled = sources.filter((s) => s.enabled);
  return {
    at: now.toISOString(),
    summary: {
      enabled: enabled.length,
      ok: enabled.filter((s) => s.state === "ok").length,
      stale: enabled.filter((s) => s.state === "stale").length,
      failing: enabled.filter((s) => s.state === "failing" || s.state === "blocked").length,
      lastIngestAt: enabled.map((s) => s.lastSuccessAt).filter(Boolean).sort().at(-1) ?? null,
    },
    sources,
  };
}
