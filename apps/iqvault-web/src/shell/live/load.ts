import { apiGet, type Holding, type InventoryResponse, type Signal } from "@/lib/api";
import type { InsufficientEvidenceProps, ValueRangeProps } from "../schemas";
import {
  assetFromHolding,
  coverageFromAssets,
  isBridgeSeed,
  rangeFromChip,
  rangeFromHoldingFields,
  type LiveChip,
  type VaultAssetModel,
} from "./holding";

const SLOW_READ_MS = 30_000;
const ADVISOR_READ_MS = 90_000;

export type VaultModel = {
  error: string | null;
  notice: string | null;
  sourceNote: string | null;
  assets: VaultAssetModel[];
  coverage: ReturnType<typeof coverageFromAssets>;
};

export type AdvisorAnswer =
  | {
      kind: "range";
      id: string;
      name: string;
      action: string;
      range: ValueRangeProps;
      limiter: string;
      sources: string[];
      counterEvidence: string[];
    }
  | {
      kind: "insufficient";
      id: string;
      name: string;
      insufficient: InsufficientEvidenceProps;
    };

export type AdvisorModel = {
  error: string | null;
  notice: string | null;
  returned: number;
  answers: AdvisorAnswer[];
};

export type SignalItemModel = {
  id: string;
  category: string;
  title: string;
  body: string;
  date: string;
  quarantine: string;
  linkage:
    | { status: "resolved"; whyVipCares: string; holdingName: string; range: ValueRangeProps }
    | { status: "unavailable"; note: string; originTitle: string };
};

export type SignalsModel = {
  error: string | null;
  notice: string | null;
  source: string | null;
  items: SignalItemModel[];
};

export type IngestUnitModel = {
  id: string;
  title: string;
  note: string;
  candidates: { id: string; label: string; confidence: number }[];
};

export type IngestModel = {
  error: string | null;
  stage: string;
  batchName: string | null;
  units: IngestUnitModel[];
  gateNote: string;
};

export type OperateModel = {
  sellError: string | null;
  sell: { id: string; name: string; priority: string | null; range: ValueRangeProps }[];
  listingsError: string | null;
  listings: { id: string; title: string; status: string; range: ValueRangeProps; ask: number | null }[];
  transactionsError: string | null;
  transactions: { id: string; kind: string; occurredAt: string; amount: number | null; currency: string }[];
};

type ChipResponse = {
  ranges?: Record<string, LiveChip>;
  note?: string;
};

async function readInventory(): Promise<{ data: InventoryResponse | null; error: string | null }> {
  try {
    return { data: await apiGet<InventoryResponse>("/api/inventory"), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Inventory request failed" };
  }
}

async function readChips(): Promise<Record<string, LiveChip>> {
  try {
    const data = await apiGet<ChipResponse>("/api/inventory/live-ranges");
    return data.ranges ?? {};
  } catch {
    return {};
  }
}

export async function loadVault(): Promise<VaultModel> {
  const [{ data, error }, chips] = await Promise.all([readInventory(), readChips()]);
  if (!data) {
    return {
      error,
      notice: null,
      sourceNote: null,
      assets: [],
      coverage: coverageFromAssets([]),
    };
  }
  const droppedSeeds = data.holdings.filter((holding) => isBridgeSeed(holding)).length;
  const holdings = data.holdings.filter((holding) => !isBridgeSeed(holding));
  const assets = holdings.map((holding) => assetFromHolding(holding, chips[holding.id]));
  const snapshot = data.comicsSnapshot;
  return {
    error: data.comicsAvailable ? null : data.comicsError ?? "Comics Postgres unavailable",
    notice:
      droppedSeeds > 0
        ? `${droppedSeeds} Pokémon bridge seeds are in the inventory response and are not shown.`
        : null,
    sourceNote: snapshot ? `${snapshot.label} · ${snapshot.ageDays}d · ${snapshot.shortHash}` : data.comicsSource,
    assets,
    coverage: coverageFromAssets(assets),
  };
}

type Rec = {
  holdingId: string;
  assetName: string;
  action: string;
  stance: string;
  reasonCodes: string[];
  supportingEvidence: { summary: string }[];
  opposingEvidence: { summary: string }[];
  marketRange: {
    low: number;
    high: number;
    matchedSales: number;
    recencyDays: number | null;
    confidenceBand: "low" | "medium" | "high";
  } | null;
  ruleOrModelVersion: string;
};

export async function loadAdvisor(): Promise<AdvisorModel> {
  try {
    const [data, inventory] = await Promise.all([
      apiGet<{ recommendations: Rec[] }>("/api/recommendations?limit=8", ADVISOR_READ_MS),
      readInventory(),
    ]);
    const seedIds = new Set(
      (inventory.data?.holdings ?? []).filter((holding) => isBridgeSeed(holding)).map((holding) => holding.id),
    );
    const kept = (data.recommendations ?? []).filter((rec) => !seedIds.has(rec.holdingId));
    const dropped = (data.recommendations ?? []).length - kept.length;
    const answers = kept.map(answerFromRecommendation);
    return {
      error: null,
      notice: dropped > 0 ? `${dropped} recommendations were on bridge-seed holdings and are not shown.` : null,
      returned: answers.length,
      answers,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Recommendations request failed";
    return {
      error: message,
      notice: null,
      returned: 0,
      answers: [
        {
          kind: "insufficient",
          id: "advisor-unavailable",
          name: "Advisor",
          insufficient: {
            reason: message,
            facts: ["The recommendation request did not return a range."],
            actions: [
              { label: "Open the vault", href: "/vault" },
              { label: "Open ingest", href: "/ingest" },
            ],
          },
        },
      ],
    };
  }
}

function answerFromRecommendation(rec: Rec): AdvisorAnswer {
  const range = rec.marketRange;
  if (!range || range.matchedSales <= 0) {
    return {
      kind: "insufficient",
      id: rec.holdingId,
      name: rec.assetName,
      insufficient: {
        reason: `${rec.assetName}: no matched sales, so there is no range.`,
        facts: rec.reasonCodes.length ? rec.reasonCodes : ["The decision engine returned no market range."],
        actions: [
          { label: "Open the vault", href: "/vault" },
          { label: "Open ingest", href: "/ingest" },
        ],
      },
    };
  }
  return {
    kind: "range",
    id: rec.holdingId,
    name: rec.assetName,
    action: `${rec.stance} · ${rec.action}`,
    range: {
      low: range.low,
      high: range.high,
      compCount: range.matchedSales,
      recencyDays: range.recencyDays,
      confidence: range.confidenceBand,
      evidenceLabel: "comps",
    },
    limiter: `${rec.ruleOrModelVersion}. Confidence band ${range.confidenceBand}.`,
    sources: rec.supportingEvidence.map((row) => row.summary).filter(Boolean),
    counterEvidence: rec.opposingEvidence.map((row) => row.summary).filter(Boolean),
  };
}

type FeedSignal = Signal & { assetId?: string | null; title?: string };

export async function loadSignals(): Promise<SignalsModel> {
  const [signalsResult, inventory] = await Promise.all([
    apiGet<{ signals: FeedSignal[]; source?: string; feed?: { job?: string | null; writtenAt?: string } | null }>(
      "/api/signals",
    ).then(
      (data) => ({ data, error: null as string | null }),
      (e: unknown) => ({ data: null, error: e instanceof Error ? e.message : "Signals request failed" }),
    ),
    readInventory(),
  ]);
  if (!signalsResult.data) {
    return { error: signalsResult.error, notice: null, source: null, items: [] };
  }
  if (signalsResult.data.source === "seed") {
    return {
      error: null,
      notice: "The signals file is empty. Built-in sample signals are not shown.",
      source: null,
      items: [],
    };
  }
  const byId = new Map((inventory.data?.holdings ?? []).map((holding) => [holding.id, holding]));
  const chips = inventory.data ? await readChips() : {};
  const feed = signalsResult.data.feed;
  const source = [signalsResult.data.source, feed?.job, feed?.writtenAt?.slice(0, 19)].filter(Boolean).join(" · ");
  return {
    error: null,
    notice: null,
    source: source || null,
    items: signalsResult.data.signals.map((signal) => signalItem(signal, byId, chips)),
  };
}

export function signalItem(signal: FeedSignal, byId: Map<string, Holding>, chips: Record<string, LiveChip>): SignalItemModel {
  const holding = signal.assetId ? byId.get(signal.assetId) : undefined;
  const base = {
    id: signal.id,
    category: signal.signalType,
    title: signal.title?.trim() || signal.signalType,
    body: signal.body,
    date: signal.signalDate,
    quarantine: signal.quarantineStatus,
  };
  if (!holding) {
    return {
      ...base,
      linkage: {
        status: "unavailable",
        note: "Portfolio impact is unavailable. This signal has no holding id on the feed.",
        originTitle: signal.sourceUrl?.trim() || signal.signalType,
      },
    };
  }
  return {
    ...base,
    linkage: {
      status: "resolved",
      holdingName: holding.assetName,
      whyVipCares: `Linked holding ${holding.assetName}. The signal annotates that holding. It is not a price.`,
      range: chips[holding.id] ? rangeFromChip(chips[holding.id]) : rangeFromHoldingFields(holding),
    },
  };
}

type WorkspaceBatch = {
  name: string | null;
  lifecycle: string;
  destination: string | null;
  review: number;
};

const INGEST_GATE_NOTE =
  "False auto-confirm rate is not recorded. Auto-confirm threshold is not on the batch.";

export async function loadIngest(): Promise<IngestModel> {
  try {
    const data = await apiGet<{ batches: WorkspaceBatch[] }>("/api/ingest/workspace");
    const active = data.batches.find((batch) => batch.lifecycle === "active");
    if (!active) {
      return { error: null, stage: "no active batch", batchName: null, units: [], gateNote: INGEST_GATE_NOTE };
    }
    return {
      error: null,
      stage: active.review > 0 ? "review" : "capture",
      batchName: active.name ?? active.destination,
      units: [],
      gateNote: INGEST_GATE_NOTE,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Ingest workspace failed",
      stage: "unavailable",
      batchName: null,
      units: [],
      gateNote: INGEST_GATE_NOTE,
    };
  }
}

export async function loadOperate(): Promise<OperateModel> {
  const [sell, listings, transactions] = await Promise.all([
    apiGet<{ items: Holding[] }>("/api/sell-queue", SLOW_READ_MS).then(
      (data) => ({ items: data.items ?? [], error: null as string | null }),
      (e: unknown) => ({ items: [], error: e instanceof Error ? e.message : "Sell queue request failed" }),
    ),
    apiGet<{ drafts: { id: string; title: string; status: string; askPrice: number | null; liveLow: number | null; liveHigh: number | null; listingCount: number }[] }>(
      "/api/listings",
    ).then(
      (data) => ({ drafts: data.drafts ?? [], error: null as string | null }),
      (e: unknown) => ({ drafts: [], error: e instanceof Error ? e.message : "Listings request failed" }),
    ),
    apiGet<{ items: { id: string; kind: string; occurredAt: string; amount: number | null; currency: string }[] }>(
      "/api/transactions",
    ).then(
      (data) => ({ items: data.items ?? [], error: null as string | null }),
      (e: unknown) => ({ items: [], error: e instanceof Error ? e.message : "Transactions request failed" }),
    ),
  ]);
  return {
    sellError: sell.error,
    sell: sell.items.filter((item) => !isBridgeSeed(item)).map((item) => ({
      id: item.id,
      name: item.assetName,
      priority: item.sellPriority,
      range: rangeFromHoldingFields(item),
    })),
    listingsError: listings.error,
    listings: listings.drafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      status: draft.status,
      ask: draft.askPrice,
      range: rangeFromHoldingFields({
        liveLow: draft.liveLow,
        liveHigh: draft.liveHigh,
        liveListingCount: draft.listingCount,
      }),
    })),
    transactionsError: transactions.error,
    transactions: transactions.items,
  };
}

export async function loadHome(): Promise<{ vault: VaultModel; signals: SignalsModel; ingest: IngestModel }> {
  const [vault, signals, ingest] = await Promise.all([loadVault(), loadSignals(), loadIngest()]);
  return { vault, signals, ingest };
}
