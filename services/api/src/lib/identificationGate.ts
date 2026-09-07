import { sql } from "drizzle-orm";
import {
  scoreLiveIdentificationGate,
  type LiveGateUnitInput,
  type LiveIdentificationGateReport,
} from "@vip/scan-ingest";
import { getDb } from "../db/client.js";

function sourcesOf(ext: unknown): string[] {
  if (!Array.isArray(ext)) return [];
  return ext
    .map((row) =>
      row && typeof row === "object" && "source" in row
        ? String((row as { source: unknown }).source).toLowerCase()
        : "",
    )
    .filter(Boolean);
}

function asCategory(value: unknown): LiveGateUnitInput["category"] {
  const kind = String(value ?? "");
  if (kind === "pokemon" || kind === "mtg" || kind === "sports") return kind;
  return null;
}

export async function loadLiveIdentificationUnits(): Promise<LiveGateUnitInput[]> {
  const db = getDb();
  const units = await db.execute(sql`
    SELECT
      u.id,
      u.category_hint,
      u.holding_id,
      u.id_observation_ref,
      obs.was_correct,
      COALESCE(
        (
          SELECT json_agg(json_build_object(
            'displayName', c.display_name,
            'adapterId', c.adapter_id,
            'confidence', c.confidence,
            'category', c.category,
            'externalIds', c.external_ids
          ) ORDER BY c.confidence DESC)
          FROM vault_media.scan_unit_candidate c
          WHERE c.unit_id = u.id
        ),
        '[]'::json
      ) AS candidates
    FROM vault_media.scan_unit u
    LEFT JOIN vault_market.id_observation obs
      ON obs.id::text = u.id_observation_ref
    ORDER BY u.created_at DESC
  `);

  const rows: LiveGateUnitInput[] = [];
  for (const row of units.rows as Array<Record<string, unknown>>) {
    const candidates = Array.isArray(row.candidates)
      ? (row.candidates as Array<Record<string, unknown>>)
      : [];
    const top = candidates[0];
    const category = asCategory(top?.category ?? row.category_hint);
    if (category !== "pokemon" && category !== "mtg") continue;
    const required = category === "pokemon" ? "tcgdex" : "scryfall";
    const withRequired = candidates.filter((c) =>
      sourcesOf(c.externalIds).includes(required),
    ).length;
    rows.push({
      unitId: String(row.id),
      category,
      displayName: top ? String(top.displayName ?? "") : null,
      adapterId: top ? String(top.adapterId ?? "") : null,
      confidence: top?.confidence == null ? null : Number(top.confidence),
      externalSources: sourcesOf(top?.externalIds),
      candidateCount: candidates.length,
      candidatesWithRequiredId: withRequired,
      holdingWritten: Boolean(row.holding_id),
      confirmedCorrect:
        row.was_correct === true ? true : row.was_correct === false ? false : null,
    });
  }
  return rows;
}

export async function scoreIdentificationGateFromDb(): Promise<LiveIdentificationGateReport> {
  return scoreLiveIdentificationGate(await loadLiveIdentificationUnits());
}
