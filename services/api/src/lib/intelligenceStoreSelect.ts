import {
  IntelligenceStoreModeSchema,
  type IntelligenceStoreKind,
  type IntelligenceStoreMode,
} from "@vip/intelligence";
import { getPool } from "../db/client.js";
import { jsonIntelligenceStore, type IntelligenceStore } from "./intelligenceStore.js";
import { isPgUnavailable, pgIntelligenceStore } from "./intelligenceStorePg.js";

/**
 * Picks the backend for each intelligence call.
 *
 *   VIP_INTELLIGENCE_STORE=auto (default) — Postgres; JSON only when Postgres
 *     cannot be reached or is not migrated (connection / undefined-table
 *     errors). Constraint and trigger rejections are NOT a fallback: they are
 *     the guardrails and surface to the caller.
 *   VIP_INTELLIGENCE_STORE=postgres — Postgres only; unreachable is a 503.
 *   VIP_INTELLIGENCE_STORE=json — the legacy JSON file only.
 *
 * Every result names the store that answered, so a JSON fallback is never
 * presented as the durable ledger.
 */
export type StoreResult<T> = {
  store: IntelligenceStoreKind;
  value: T;
  /** Set when auto mode fell back to JSON. */
  fallbackReason?: string;
};

export type IntelligenceStoreSelector = {
  readonly mode: IntelligenceStoreMode;
  run<T>(fn: (store: IntelligenceStore) => Promise<T>): Promise<StoreResult<T>>;
};

export class IntelligenceStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntelligenceStoreUnavailableError";
  }
}

export function intelligenceStoreMode(env = process.env): IntelligenceStoreMode {
  const parsed = IntelligenceStoreModeSchema.safeParse(
    (env.VIP_INTELLIGENCE_STORE ?? "auto").trim().toLowerCase(),
  );
  return parsed.success ? parsed.data : "auto";
}

export function createIntelligenceStoreSelector(opts: {
  mode?: IntelligenceStoreMode;
  pg?: () => IntelligenceStore;
  json?: () => IntelligenceStore;
} = {}): IntelligenceStoreSelector {
  const mode = opts.mode ?? intelligenceStoreMode();
  const pg = opts.pg ?? (() => pgIntelligenceStore(getPool()));
  const json = opts.json ?? jsonIntelligenceStore;

  return {
    mode,
    async run<T>(fn: (store: IntelligenceStore) => Promise<T>): Promise<StoreResult<T>> {
      if (mode === "json") return { store: "json", value: await fn(json()) };
      try {
        return { store: "postgres", value: await fn(pg()) };
      } catch (e) {
        if (!isPgUnavailable(e)) throw e;
        const reason = e instanceof Error ? e.message.split("\n")[0]! : String(e);
        if (mode === "postgres") {
          throw new IntelligenceStoreUnavailableError(`Postgres intelligence store unavailable: ${reason}`);
        }
        return { store: "json", value: await fn(json()), fallbackReason: reason };
      }
    },
  };
}
