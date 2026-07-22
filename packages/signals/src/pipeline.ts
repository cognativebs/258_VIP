import { randomUUID } from "node:crypto";
import { dedupeKey, noveltyScore } from "./dedupe.js";
import { SourceRegistry } from "./registry.js";
import { AppendOnlyStageStore } from "./store.js";
import type { StageRecord } from "./types.js";

export type IngestEvent = {
  sourceId: string;
  title: string;
  body: string;
  url?: string | null;
  externalId?: string | null;
  observedAt?: Date;
  assetHints?: string[];
};

export type PipelineResult = {
  runId: string;
  stages: StageRecord[];
  quarantined: boolean;
  noveltyScore: number;
  delta: {
    newSignals: number;
    quarantined: number;
    recommendationChanges: number;
  };
};

/**
 * SourceObservation → RawEvent → DeduplicatedEvent → NormalizedSignal
 * → AssetImpact → ThesisUpdate → RecommendationChange
 * Each stage is stored; never overwritten.
 */
export function runSignalPipeline(
  events: IngestEvent[],
  opts: {
    store?: AppendOnlyStageStore;
    registry?: SourceRegistry;
    priorSignalBodies?: string[];
    runId?: string;
  } = {},
): PipelineResult {
  const store = opts.store ?? new AppendOnlyStageStore();
  const registry = opts.registry ?? new SourceRegistry();
  const runId = opts.runId ?? randomUUID();
  const priorBodies = [...(opts.priorSignalBodies ?? [])];
  const seenKeys = new Set<string>();

  let newSignals = 0;
  let quarantined = 0;
  let recommendationChanges = 0;

  for (const event of events) {
    const source = registry.get(event.sourceId);
    const observedAt = event.observedAt ?? new Date();

    const obs = store.append({
      runId,
      stage: "SourceObservation",
      payload: {
        sourceId: event.sourceId,
        sourceName: source?.name ?? event.sourceId,
        fetchedAt: observedAt.toISOString(),
        accessMethod: source?.accessMethod ?? "manual",
      },
    });

    const raw = store.append({
      runId,
      stage: "RawEvent",
      parentIds: [obs.id],
      payload: {
        title: event.title,
        body: event.body,
        url: event.url ?? null,
        externalId: event.externalId ?? null,
        observedAt: observedAt.toISOString(),
      },
    });

    const key = dedupeKey({
      sourceId: event.sourceId,
      title: event.title,
      url: event.url,
      externalId: event.externalId,
    });

    if (seenKeys.has(key)) {
      store.append({
        runId,
        stage: "DeduplicatedEvent",
        parentIds: [raw.id],
        dedupeKey: key,
        quarantineStatus: "quarantined",
        noveltyScore: 0,
        notes: "Duplicate within run — syndicated/repeated",
        payload: { title: event.title, duplicate: true },
      });
      quarantined += 1;
      continue;
    }
    seenKeys.add(key);

    const novelty = noveltyScore(event.body, priorBodies);
    const dedup = store.append({
      runId,
      stage: "DeduplicatedEvent",
      parentIds: [raw.id],
      dedupeKey: key,
      noveltyScore: novelty.score,
      quarantineStatus: novelty.suggestQuarantine ? "quarantined" : "active",
      notes: novelty.suggestQuarantine
        ? `Low novelty (sim=${novelty.maxSimilarity}) — quarantined, not deleted`
        : "Unique in corpus",
      payload: {
        title: event.title,
        maxSimilarity: novelty.maxSimilarity,
      },
    });

    if (novelty.suggestQuarantine) {
      quarantined += 1;
      continue;
    }

    const signal = store.append({
      runId,
      stage: "NormalizedSignal",
      parentIds: [dedup.id],
      noveltyScore: novelty.score,
      payload: {
        signalType: source?.authority === "retail" ? "retail" : "news",
        body: event.body,
        title: event.title,
        sourceUrl: event.url ?? null,
        signalDate: observedAt.toISOString().slice(0, 10),
      },
    });
    priorBodies.push(event.body);
    newSignals += 1;

    const impact = store.append({
      runId,
      stage: "AssetImpact",
      parentIds: [signal.id],
      payload: {
        assetHints: event.assetHints ?? [],
        impact: event.assetHints?.length ? "watch" : "informational",
      },
    });

    const thesis = store.append({
      runId,
      stage: "ThesisUpdate",
      parentIds: [impact.id],
      payload: {
        thesisDelta: event.assetHints?.length
          ? `New evidence for ${event.assetHints.join(", ")}`
          : "No asset-linked thesis change",
      },
    });

    const recChange = Boolean(event.assetHints?.length && novelty.score >= 0.4);
    store.append({
      runId,
      stage: "RecommendationChange",
      parentIds: [thesis.id],
      payload: {
        changed: recChange,
        stanceHint: recChange ? "Watch" : "Hold",
        reason: recChange
          ? "Novel asset-linked signal — surface Watch review"
          : "No recommendation change",
      },
    });
    if (recChange) recommendationChanges += 1;
  }

  return {
    runId,
    stages: store.listByRun(runId),
    quarantined: quarantined > 0,
    noveltyScore:
      store
        .listByRun(runId)
        .map((s) => s.noveltyScore ?? 0)
        .reduce((a, b) => Math.max(a, b), 0),
    delta: {
      newSignals,
      quarantined,
      recommendationChanges,
    },
  };
}
