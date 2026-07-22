import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppendOnlyStageStore,
  PredictionLedger,
  runSignalPipeline,
  type IngestEvent,
} from "@vip/signals";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "..", ".state");
const STATE_FILE = join(STATE_DIR, "pokemon-drops-state.json");

export type JobState = {
  lastRunAt: string | null;
  priorSignalBodies: string[];
  lastDelta: DeltaReport | null;
  runCount: number;
};

export type DeltaReport = {
  job: "pokemon-drops";
  runId: string;
  ranAt: string;
  triggeredBy: "schedule" | "cli" | "test";
  previousRunAt: string | null;
  whatChanged: {
    newSignals: number;
    quarantined: number;
    recommendationChanges: number;
    newTitles: string[];
  };
  predictionsOpen: number;
  notes: string[];
};

function loadState(): JobState {
  if (!existsSync(STATE_FILE)) {
    return {
      lastRunAt: null,
      priorSignalBodies: [],
      lastDelta: null,
      runCount: 0,
    };
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as JobState;
}

function saveState(state: JobState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

/** Seed / adapter stub: in production this pulls from registered sources on a schedule. */
export function fetchPokemonDropObservations(now = new Date()): IngestEvent[] {
  const day = now.toISOString().slice(0, 10);
  return [
    {
      sourceId: "retail-drop-watch",
      title: `Pokémon 30th ETB sighting ${day}`,
      body: `Retail adapter observed Pokémon 30th ETB availability signal on ${day}. Treat price as unverified until listing proof.`,
      url: `https://example.invalid/drops/etb/${day}`,
      externalId: `etb-${day}`,
      assetHints: ["pokemon-30th-etb"],
      observedAt: now,
    },
    {
      sourceId: "pokemon-news-rss",
      title: "30th celebration reprint chatter",
      body: "Syndicated reprint chatter recirculating without new SKUs — likely noise.",
      url: "https://example.invalid/news/reprint-chatter",
      externalId: "reprint-chatter-static",
      observedAt: now,
    },
    // Intentional near-duplicate of reprint chatter for quarantine path
    {
      sourceId: "pokemon-news-rss",
      title: "30th celebration reprint chatter (mirror)",
      body: "Syndicated reprint chatter recirculating without new SKUs — likely noise.",
      url: "https://example.invalid/news/reprint-chatter",
      externalId: "reprint-chatter-static",
      observedAt: now,
    },
  ];
}

export function runPokemonDropsJob(opts: {
  triggeredBy: DeltaReport["triggeredBy"];
  now?: Date;
  persist?: boolean;
}): { delta: DeltaReport; state: JobState } {
  const now = opts.now ?? new Date();
  const persist = opts.persist ?? true;
  const state = loadState();
  const store = new AppendOnlyStageStore();
  const events = fetchPokemonDropObservations(now);

  const pipeline = runSignalPipeline(events, {
    store,
    priorSignalBodies: state.priorSignalBodies,
  });

  const newTitles = pipeline.stages
    .filter((s) => s.stage === "NormalizedSignal")
    .map((s) => String((s.payload as { title?: string }).title ?? ""));

  const ledger = new PredictionLedger();
  if (pipeline.delta.newSignals > 0) {
    ledger.add({
      claim: "Next 14d: at least one actionable 30th sealed restock under buy-under",
      probability: 0.4,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 14 * 86400000),
      evidenceRefs: pipeline.stages
        .filter((s) => s.stage === "NormalizedSignal")
        .map((s) => s.id),
      action: "Hold",
    });
  }

  const delta: DeltaReport = {
    job: "pokemon-drops",
    runId: pipeline.runId,
    ranAt: now.toISOString(),
    triggeredBy: opts.triggeredBy,
    previousRunAt: state.lastRunAt,
    whatChanged: {
      newSignals: pipeline.delta.newSignals,
      quarantined: pipeline.delta.quarantined,
      recommendationChanges: pipeline.delta.recommendationChanges,
      newTitles,
    },
    predictionsOpen: ledger.calibrationSummary().pending,
    notes: [
      "Zero-touch run: no interactive confirmation required.",
      "Noise quarantined, not deleted.",
      `Stages stored append-only: ${pipeline.stages.length}`,
    ],
  };

  const nextBodies = [
    ...state.priorSignalBodies,
    ...pipeline.stages
      .filter((s) => s.stage === "NormalizedSignal")
      .map((s) => String((s.payload as { body?: string }).body ?? "")),
  ].slice(-50);

  const nextState: JobState = {
    lastRunAt: delta.ranAt,
    priorSignalBodies: nextBodies,
    lastDelta: delta,
    runCount: state.runCount + 1,
  };

  if (persist) saveState(nextState);
  return { delta, state: nextState };
}

export function formatDeltaReport(delta: DeltaReport): string {
  return [
    `VIP Job Delta — ${delta.job}`,
    `runId: ${delta.runId}`,
    `ranAt: ${delta.ranAt} (${delta.triggeredBy})`,
    `previousRunAt: ${delta.previousRunAt ?? "none"}`,
    `whatChanged: +${delta.whatChanged.newSignals} signals, ${delta.whatChanged.quarantined} quarantined, ${delta.whatChanged.recommendationChanges} rec changes`,
    `newTitles: ${delta.whatChanged.newTitles.join(" | ") || "(none)"}`,
    `predictionsOpen: ${delta.predictionsOpen}`,
    ...delta.notes.map((n) => `- ${n}`),
  ].join("\n");
}

export { STATE_FILE, STATE_DIR };
