import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppendOnlyStageStore,
  PredictionLedger,
  RssAdapter,
  SourceRegistry,
  defaultSourcesStatePath,
  isSourceActive,
  runSignalPipeline,
  type IngestEvent,
  type StageRecord,
} from "@vip/signals";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "..", ".state");
const STATE_FILE = join(STATE_DIR, "pokemon-drops-state.json");
const FEED_FILE = process.env.VIP_SIGNALS_FEED ?? join(STATE_DIR, "signals-feed.json");
const SNAPSHOT_DIR = join(STATE_DIR, "snapshots");
const SOURCES_STATE = defaultSourcesStatePath(FEED_FILE);
/** Offline fixture — not a live hostname (AT-09). Override with VIP_RSS_FIXTURE. */
const DEFAULT_FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "packages",
  "signals",
  "src",
  "adapters",
  "fixtures",
  "pokemon-news-sample.xml",
);

type NormalizedPayload = {
  signalType?: string;
  body?: string;
  title?: string;
  sourceUrl?: string | null;
  signalDate?: string;
};

function writeSignalsFeed(stages: StageRecord[], runId: string, ranAt: string): void {
  const signals = stages
    .filter((s) => s.stage === "NormalizedSignal")
    .map((s) => {
      const p = s.payload as NormalizedPayload;
      const signalType =
        p.signalType === "market" ||
        p.signalType === "supply" ||
        p.signalType === "retail" ||
        p.signalType === "reprint" ||
        p.signalType === "auction"
          ? p.signalType
          : "news";
      return {
        id: s.id,
        signalType,
        body: String(p.body ?? p.title ?? "signal"),
        sourceUrl: p.sourceUrl ?? null,
        signalDate: String(p.signalDate ?? ranAt.slice(0, 10)),
        noveltyScore: s.noveltyScore ?? null,
        quarantineStatus: (s.quarantineStatus ?? "active") as
          | "active"
          | "quarantined"
          | "rejected",
        title: p.title,
      };
    });

  // Also surface quarantined DeduplicatedEvents so IQVault can show labeled noise
  const quarantined = stages
    .filter((s) => s.stage === "DeduplicatedEvent" && s.quarantineStatus === "quarantined")
    .map((s) => {
      const p = s.payload as { title?: string };
      return {
        id: s.id,
        signalType: "news" as const,
        body: String(p.title ?? "Quarantined duplicate/noise"),
        sourceUrl: null,
        signalDate: ranAt.slice(0, 10),
        noveltyScore: s.noveltyScore ?? null,
        quarantineStatus: "quarantined" as const,
        title: p.title,
      };
    });

  const feed = {
    schema: "vip_signals_feed_v1" as const,
    writtenAt: ranAt,
    runId,
    job: "pokemon-drops",
    provenance: {
      source: "pokemon-drops-job",
      method: "pipeline",
      ruleOrModelVersion: "signals@0.1.0",
      verificationStatus: "unverified" as const,
      notes: "NormalizedSignal stages from append-only pipeline — not live comps",
    },
    signals: [...signals, ...quarantined],
  };

  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(FEED_FILE, JSON.stringify(feed, null, 2), "utf8");
}

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

function rssConfig(feedUrl: string) {
  return {
    feedUrl,
    sourceId: "pokemon-news-rss",
    rateLimitMs: Number(process.env.VIP_RSS_RATE_LIMIT_MS ?? 1000),
    snapshotDir: SNAPSHOT_DIR,
  };
}

function newsEventsFromFixture(now: Date): IngestEvent[] {
  const fixturePath = process.env.VIP_RSS_FIXTURE ?? DEFAULT_FIXTURE;
  if (!existsSync(fixturePath)) {
    throw new Error(`RSS fixture missing: ${fixturePath}`);
  }
  const rawXml = readFileSync(fixturePath, "utf8");
  const adapter = new RssAdapter(rssConfig("fixture://pokemon-news-sample"));
  const snapshot = adapter.writeSnapshot("fixture://pokemon-news-sample", rawXml, now);
  const signals = adapter.parseSnapshot(snapshot);
  const events = RssAdapter.toIngestEvents(signals);
  // Pipeline dogfood: near-duplicate body with distinct externalId → quarantine path
  const reprint = events.find((e) => /reprint/i.test(e.title));
  if (reprint) {
    events.push({
      ...reprint,
      title: `${reprint.title} (mirror)`,
      externalId: `${reprint.externalId ?? "reprint"}-mirror`,
      observedAt: now,
    });
  }
  return events;
}

/**
 * Collect observations. News path uses RssAdapter + immutable snapshot.
 * Live fetch when VIP_POKEMON_NEWS_RSS_URL / RSS_FEED_URL is set; otherwise offline fixture.
 * Skips inactive sources via persisted SourceRegistry state.
 */
export function fetchPokemonDropObservations(now = new Date()): IngestEvent[] {
  const day = now.toISOString().slice(0, 10);
  const registry = new SourceRegistry();
  const events: IngestEvent[] = [];

  const retail = registry.get("retail-drop-watch");
  if (
    isSourceActive("retail-drop-watch", {
      defaultActive: retail?.active ?? true,
      statePath: SOURCES_STATE,
    })
  ) {
    events.push({
      sourceId: "retail-drop-watch",
      title: `Pokémon 30th ETB sighting ${day}`,
      body: `Retail adapter observed Pokémon 30th ETB availability signal on ${day}. Treat price as unverified until listing proof.`,
      url: `https://example.invalid/drops/etb/${day}`,
      externalId: `etb-${day}`,
      assetHints: ["pokemon-30th-etb"],
      observedAt: now,
    });
  }

  const news = registry.get("pokemon-news-rss");
  if (
    !isSourceActive("pokemon-news-rss", {
      defaultActive: news?.active ?? true,
      statePath: SOURCES_STATE,
    })
  ) {
    return events;
  }

  const liveUrl = (process.env.VIP_POKEMON_NEWS_RSS_URL || process.env.RSS_FEED_URL || "").trim();
  if (liveUrl) {
    // Sync API keeps tests/CLI simple; live URL path is async via collectPokemonDropObservations.
    // Callers that set a live URL should use collectPokemonDropObservations / runPokemonDropsJobAsync.
    events.push(...newsEventsFromFixture(now));
    return events;
  }

  events.push(...newsEventsFromFixture(now));
  return events;
}

export async function collectPokemonDropObservations(now = new Date()): Promise<IngestEvent[]> {
  const liveUrl = (process.env.VIP_POKEMON_NEWS_RSS_URL || process.env.RSS_FEED_URL || "").trim();
  if (!liveUrl) return fetchPokemonDropObservations(now);

  const registry = new SourceRegistry();
  const events: IngestEvent[] = [];
  const retail = registry.get("retail-drop-watch");
  if (
    isSourceActive("retail-drop-watch", {
      defaultActive: retail?.active ?? true,
      statePath: SOURCES_STATE,
    })
  ) {
    const day = now.toISOString().slice(0, 10);
    events.push({
      sourceId: "retail-drop-watch",
      title: `Pokémon 30th ETB sighting ${day}`,
      body: `Retail adapter observed Pokémon 30th ETB availability signal on ${day}. Treat price as unverified until listing proof.`,
      url: `https://example.invalid/drops/etb/${day}`,
      externalId: `etb-${day}`,
      assetHints: ["pokemon-30th-etb"],
      observedAt: now,
    });
  }

  const news = registry.get("pokemon-news-rss");
  if (
    !isSourceActive("pokemon-news-rss", {
      defaultActive: news?.active ?? true,
      statePath: SOURCES_STATE,
    })
  ) {
    return events;
  }

  const adapter = new RssAdapter(rssConfig(liveUrl));
  const snapshot = await adapter.fetchAndSnapshot(now);
  const signals = adapter.parseSnapshot(snapshot);
  events.push(...RssAdapter.toIngestEvents(signals));
  return events;
}

export function runPokemonDropsJob(opts: {
  triggeredBy: DeltaReport["triggeredBy"];
  now?: Date;
  persist?: boolean;
  /** When set, use these instead of on-disk prior bodies (tests / one-shots). */
  priorSignalBodies?: string[];
  /** Override ingest events (tests / async collector). */
  events?: IngestEvent[];
}): { delta: DeltaReport; state: JobState } {
  const now = opts.now ?? new Date();
  const persist = opts.persist ?? true;
  const state = loadState();
  const store = new AppendOnlyStageStore();
  const events = opts.events ?? fetchPokemonDropObservations(now);
  const priorBodies = opts.priorSignalBodies ?? state.priorSignalBodies;

  const pipeline = runSignalPipeline(events, {
    store,
    priorSignalBodies: priorBodies,
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

  if (persist) {
    saveState(nextState);
    writeSignalsFeed(pipeline.stages, pipeline.runId, delta.ranAt);
  }
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

export async function runPokemonDropsJobAsync(opts: {
  triggeredBy: DeltaReport["triggeredBy"];
  now?: Date;
  persist?: boolean;
  priorSignalBodies?: string[];
}): Promise<{ delta: DeltaReport; state: JobState }> {
  const now = opts.now ?? new Date();
  const events = await collectPokemonDropObservations(now);
  return runPokemonDropsJob({ ...opts, now, events });
}

export { STATE_FILE, STATE_DIR, FEED_FILE, SNAPSHOT_DIR, SOURCES_STATE };
