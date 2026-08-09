import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { markObserved } from "@vip/evidence";

/**
 * Comics Terminal edits through the VIP API (same Postgres as Comics API :5200).
 * Display keys stay CLZ-shaped so the collector face can patch without the
 * Python process. Inferred grades are never invented here — only columns the
 * operator explicitly sets.
 */

export const COMICS_WRITE_RULE = "vip-comics-holding-write@0.1.0";

const yesNoSchema = z.union([
  z.boolean(),
  z.enum(["Yes", "No", "yes", "no", "true", "false", "1", "0"]),
]);

export const comicHoldingFieldsSchema = z
  .object({
    Quantity: z.coerce.number().int().positive().optional(),
    Location: z.string().nullable().optional(),
    "Purchase Price": z.coerce.number().optional(),
    "Current Price": z.coerce.number().optional(),
    "Slab Status": z.string().nullable().optional(),
    "Assumed Grade": z.string().nullable().optional(),
    "Grade Rating": z.coerce.number().optional(),
    "Collection Pillar": z.string().nullable().optional(),
    "Museum Score": z.coerce.number().optional(),
    "Investment Score": z.coerce.number().optional(),
    "Liquidity Score": z.coerce.number().optional(),
    Recommendation: z.string().nullable().optional(),
    "Sell Priority": z.string().nullable().optional(),
    "Verification Notes": z.string().nullable().optional(),
    "Upgrade Candidate": yesNoSchema.optional(),
    "Needs Grading": yesNoSchema.optional(),
    "Needs Photo": yesNoSchema.optional(),
    "Needs Verification": yesNoSchema.optional(),
    "Value Locked": yesNoSchema.optional(),
  })
  .strict();

export type ComicHoldingFields = z.infer<typeof comicHoldingFieldsSchema>;

export const comicHoldingPatchBodySchema = z.union([
  z.object({ fields: comicHoldingFieldsSchema }),
  comicHoldingFieldsSchema,
]);

function toBool(val: unknown): boolean | null {
  if (val == null || val === "") return null;
  if (typeof val === "boolean") return val;
  const s = String(val).trim().toLowerCase();
  if (["yes", "true", "1"].includes(s)) return true;
  if (["no", "false", "0"].includes(s)) return false;
  return null;
}

function yn(val: boolean | null): string {
  return val ? "Yes" : "No";
}

type ColPatch = {
  column: string;
  value: unknown;
  metaKey: string;
  metaValue: unknown;
};

function buildPatches(fields: ComicHoldingFields): ColPatch[] {
  const out: ColPatch[] = [];
  const add = (metaKey: string, column: string, value: unknown, metaValue: unknown) => {
    if (value === undefined) return;
    out.push({ column, value, metaKey, metaValue });
  };

  add("Quantity", "quantity", fields.Quantity, fields.Quantity);
  add("Location", "location", fields.Location, fields.Location);
  add("Purchase Price", "purchase_price", fields["Purchase Price"], fields["Purchase Price"]);
  add("Current Price", "current_price_snapshot", fields["Current Price"], fields["Current Price"]);
  add("Slab Status", "slab_status", fields["Slab Status"], fields["Slab Status"]);
  add("Assumed Grade", "assumed_grade", fields["Assumed Grade"], fields["Assumed Grade"]);
  add("Grade Rating", "grade_rating", fields["Grade Rating"], fields["Grade Rating"]);
  add(
    "Collection Pillar",
    "collection_pillar",
    fields["Collection Pillar"],
    fields["Collection Pillar"],
  );
  add("Museum Score", "museum_score", fields["Museum Score"], fields["Museum Score"]);
  add("Investment Score", "investment_score", fields["Investment Score"], fields["Investment Score"]);
  add("Liquidity Score", "liquidity_score", fields["Liquidity Score"], fields["Liquidity Score"]);
  add("Recommendation", "recommendation", fields.Recommendation, fields.Recommendation);
  add("Sell Priority", "sell_priority", fields["Sell Priority"], fields["Sell Priority"]);
  add(
    "Verification Notes",
    "verification_notes",
    fields["Verification Notes"],
    fields["Verification Notes"],
  );

  for (const [metaKey, column] of [
    ["Upgrade Candidate", "upgrade_candidate"],
    ["Needs Grading", "needs_grading"],
    ["Needs Photo", "needs_photo"],
    ["Needs Verification", "needs_verification"],
    ["Value Locked", "value_locked"],
  ] as const) {
    if (fields[metaKey] === undefined) continue;
    const b = toBool(fields[metaKey]);
    add(metaKey, column, b, yn(b));
  }

  return out;
}

function ynCol(val: unknown): string {
  return val ? "Yes" : "No";
}

function num(val: unknown, fallback = 0): number {
  if (val == null || val === "") return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/** CLZ-shaped row for the Comics Terminal (matches Python comics_db.row_from_holding). */
export function comicRowFromDb(rec: Record<string, unknown>): Record<string, unknown> {
  const meta = (rec.clz_metadata ?? {}) as Record<string, unknown>;
  const row: Record<string, unknown> = { ...meta };

  row["Series"] = rec.series_title ?? row["Series"] ?? "";
  row["Issue"] = rec.issue_number ?? row["Issue"] ?? "";
  row["Issue Full"] = row["Issue Full"] ?? rec.issue_number ?? "";
  row["Publisher"] = rec.publisher ?? row["Publisher"] ?? "";
  row["Edition / Variant"] = rec.cover_label ?? row["Edition / Variant"] ?? "";
  row["Cover Image URL"] = rec.primary_image_url ?? row["Cover Image URL"] ?? "";

  row["Collection Pillar"] = rec.collection_pillar ?? row["Collection Pillar"] ?? "";
  row["Recommendation"] = rec.recommendation ?? row["Recommendation"] ?? "";
  row["Sell Priority"] = rec.sell_priority ?? row["Sell Priority"] ?? "";
  row["Museum Score"] = num(rec.museum_score, Number(row["Museum Score"] ?? 0));
  row["Investment Score"] = num(rec.investment_score, Number(row["Investment Score"] ?? 0));
  row["Liquidity Score"] = num(rec.liquidity_score, Number(row["Liquidity Score"] ?? 0));
  row["Upgrade Candidate"] = ynCol(rec.upgrade_candidate);
  row["Needs Grading"] = ynCol(rec.needs_grading);
  row["Needs Photo"] = ynCol(rec.needs_photo);
  row["Needs Verification"] = ynCol(rec.needs_verification);
  row["Verification Notes"] = rec.verification_notes ?? row["Verification Notes"] ?? "";
  row["Quantity"] = num(rec.quantity, Number(row["Quantity"] ?? 1));
  row["Location"] = rec.location ?? row["Location"] ?? "";
  row["Current Price"] = num(rec.current_price_snapshot, Number(row["Current Price"] ?? 0));
  row["Purchase Price"] = num(rec.purchase_price, Number(row["Purchase Price"] ?? 0));
  row["Slab Status"] = rec.slab_status ?? row["Slab Status"] ?? "";
  row["Assumed Grade"] = rec.assumed_grade ?? row["Assumed Grade"] ?? "";
  row["Grade Rating"] = num(rec.grade_rating, Number(row["Grade Rating"] ?? 0));
  row["Value Locked"] = ynCol(rec.value_locked);
  row["id"] = rec.source_row_id ?? row["id"] ?? "";
  row["_source"] = "postgres";
  return row;
}

export type UpdateComicHoldingResult =
  | {
      ok: true;
      row: Record<string, unknown>;
      provenance: ReturnType<typeof markObserved>;
    }
  | { ok: false; status: 400 | 404 | 500; error: string };

export async function updateComicHolding(
  sourceRowId: string,
  rawFields: Record<string, unknown>,
): Promise<UpdateComicHoldingResult> {
  if (!sourceRowId.trim()) {
    return { ok: false, status: 400, error: "Missing holding id" };
  }

  const parsed = comicHoldingFieldsSchema.safeParse(rawFields);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues.map((i) => i.message).join("; ") || "Invalid fields",
    };
  }

  const patches = buildPatches(parsed.data);
  if (patches.length === 0) {
    return { ok: false, status: 400, error: "No editable fields in patch" };
  }

  const metaPatch: Record<string, unknown> = {};
  for (const p of patches) {
    if (p.metaValue !== undefined && p.metaValue !== null) {
      metaPatch[p.metaKey] = p.metaValue;
    }
  }

  try {
    const db = getDb();
    // Build SET fragments from the allow-listed columns only.
    const setFragments = patches.map((p) => {
      switch (p.column) {
        case "quantity":
          return sql`quantity = ${p.value as number}`;
        case "location":
          return sql`location = ${p.value as string | null}`;
        case "purchase_price":
          return sql`purchase_price = ${p.value as number}`;
        case "current_price_snapshot":
          return sql`current_price_snapshot = ${p.value as number}`;
        case "slab_status":
          return sql`slab_status = ${p.value as string | null}`;
        case "assumed_grade":
          return sql`assumed_grade = ${p.value as string | null}`;
        case "grade_rating":
          return sql`grade_rating = ${p.value as number}`;
        case "collection_pillar":
          return sql`collection_pillar = ${p.value as string | null}`;
        case "museum_score":
          return sql`museum_score = ${p.value as number}`;
        case "investment_score":
          return sql`investment_score = ${p.value as number}`;
        case "liquidity_score":
          return sql`liquidity_score = ${p.value as number}`;
        case "recommendation":
          return sql`recommendation = ${p.value as string | null}`;
        case "sell_priority":
          return sql`sell_priority = ${p.value as string | null}`;
        case "verification_notes":
          return sql`verification_notes = ${p.value as string | null}`;
        case "upgrade_candidate":
          return sql`upgrade_candidate = ${p.value as boolean | null}`;
        case "needs_grading":
          return sql`needs_grading = ${p.value as boolean | null}`;
        case "needs_photo":
          return sql`needs_photo = ${p.value as boolean | null}`;
        case "needs_verification":
          return sql`needs_verification = ${p.value as boolean | null}`;
        case "value_locked":
          return sql`value_locked = ${p.value as boolean | null}`;
        default:
          throw new Error(`Unhandled column ${p.column}`);
      }
    });

    const metaJson = JSON.stringify(metaPatch);
    const result = await db.execute(sql`
      UPDATE vault_collection.holding
      SET ${sql.join(setFragments, sql`, `)},
          clz_metadata = COALESCE(clz_metadata, '{}'::jsonb) || ${metaJson}::jsonb,
          updated_at = now()
      WHERE source = 'clz_import' AND source_row_id = ${sourceRowId}
      RETURNING source_row_id
    `);

    if ((result.rowCount ?? 0) === 0) {
      return { ok: false, status: 404, error: `Holding not found: ${sourceRowId}` };
    }

    const loaded = await db.execute(sql`
      SELECT
          h.quantity,
          h.purchase_price,
          h.purchase_date,
          h.location,
          h.slab_status,
          h.assumed_grade,
          h.grade_rating,
          h.collection_pillar,
          h.museum_score,
          h.investment_score,
          h.liquidity_score,
          h.recommendation,
          h.sell_priority,
          h.upgrade_candidate,
          h.needs_grading,
          h.needs_photo,
          h.needs_verification,
          h.verification_notes,
          h.value_locked,
          h.current_price_snapshot,
          h.source_row_id,
          h.clz_metadata,
          h.imported_at,
          a.canonical_name,
          a.primary_image_url,
          s.title AS series_title,
          s.publisher,
          i.issue_number,
          i.is_key_issue,
          i.key_reason,
          v.cover_label
      FROM vault_collection.holding h
      JOIN vault_core.asset a ON a.id = h.asset_id
      JOIN vault_comic.variant v ON v.asset_id = a.id
      JOIN vault_comic.issue i ON i.id = v.issue_id
      JOIN vault_comic.series s ON s.id = i.series_id
      WHERE h.source = 'clz_import' AND h.source_row_id = ${sourceRowId}
    `);

    const rec = (loaded.rows as Record<string, unknown>[])[0];
    if (!rec) {
      return { ok: false, status: 404, error: `Holding not found after update: ${sourceRowId}` };
    }

    return {
      ok: true,
      row: comicRowFromDb(rec),
      provenance: markObserved({
        source: "clz_import",
        confidence: 1,
        ruleOrModelVersion: COMICS_WRITE_RULE,
        notes: `Operator patch: ${Object.keys(metaPatch).join(", ")}`,
      }),
    };
  } catch (e) {
    return {
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
