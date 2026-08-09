import { markObserved } from "@vip/evidence";
import { SCAN_DUP_RULE } from "./constants.js";
import type {
  DuplicateAlert,
  DuplicateMatch,
  IdentityCandidate,
  InventoryLookupRow,
} from "./schemas.js";

/**
 * Alert when a confirmed (or top) candidate already exists in inventory.
 * Operator must acknowledge before adding another copy.
 */
export function findDuplicates(
  unitId: string,
  candidates: IdentityCandidate[],
  inventory: InventoryLookupRow[],
): DuplicateAlert | null {
  const top = candidates[0];
  if (!top) return null;

  const matches: DuplicateMatch[] = [];
  const seen = new Set<string>();

  for (const row of inventory) {
    let match: DuplicateMatch | null = null;

    if (top.assetId && row.assetId && top.assetId === row.assetId) {
      match = {
        holdingId: row.id,
        assetId: row.assetId,
        assetName: row.assetName,
        quantity: row.quantity,
        matchKind: "same_asset",
        confidence: 1,
        notes: "Same asset id already in inventory",
      };
    } else if (
      row.catalogKey &&
      row.catalogKey === top.catalogKey
    ) {
      match = {
        holdingId: row.id,
        assetId: row.assetId ?? null,
        assetName: row.assetName,
        quantity: row.quantity,
        matchKind: "same_catalog_key",
        confidence: 0.95,
        notes: `catalogKey ${top.catalogKey} already held`,
      };
    } else {
      const extHit = top.externalIds.find((ext) =>
        row.externalIds.some(
          (e) => e.source === ext.source && e.value === ext.value,
        ),
      );
      if (extHit) {
        match = {
          holdingId: row.id,
          assetId: row.assetId ?? null,
          assetName: row.assetName,
          quantity: row.quantity,
          matchKind: "same_external_id",
          confidence: 0.98,
          notes: `${extHit.source}:${extHit.value} already held`,
        };
      }
    }

    if (match && !seen.has(match.holdingId)) {
      seen.add(match.holdingId);
      matches.push(match);
    }
  }

  if (matches.length === 0) return null;

  return {
    unitId,
    duplicates: matches,
    requiresConfirmation: true,
    provenance: markObserved({
      source: "scan_duplicate_check",
      ruleOrModelVersion: SCAN_DUP_RULE,
      confidence: 1,
      notes: `${matches.length} existing holding(s) — confirm before adding copy`,
    }),
  };
}
