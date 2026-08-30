import type { DevicePage } from "./adapters/types.js";
import { inferFaceFromFileName, pairPagesIntoUnits, stemKey } from "./adapters/folder-watch.js";
import type { ScanCategory, ScanUnitInput } from "./schemas.js";

export type PairingDecision = {
  units: ScanUnitInput[];
  orphans: DevicePage[];
  warnings: string[];
  method: "sequential_duplex" | "filename_front_back" | "auto";
  pairingConfidence: number[];
  needsReview: boolean[];
};

/**
 * Deterministic pairing. Ambiguous pairs are flagged — never guessed.
 * sequential_duplex = PaperStream ADF order (front then back).
 * filename_front_back = stem + front/back labels.
 * auto = filename when most pages are labeled, else sequential.
 */
export function pairPagesForReview(
  pages: DevicePage[],
  opts: {
    strategy?: "sequential_duplex" | "filename_front_back" | "auto";
    categoryHint?: ScanCategory | null;
  } = {},
): PairingDecision {
  const strategy = opts.strategy ?? "auto";
  const labeled = pages.filter((p) => inferFaceFromFileName(p.fileName ?? p.storageRef) !== "unknown");
  const method =
    strategy === "auto"
      ? labeled.length >= Math.ceil(pages.length * 0.5)
        ? "filename_front_back"
        : "sequential_duplex"
      : strategy;

  const units = pairPagesIntoUnits(pages, method, opts.categoryHint ?? null);
  const used = new Set<string>();
  for (const u of units) {
    used.add(u.front.contentHash);
    if (u.back) used.add(u.back.contentHash);
  }
  const orphans = pages.filter((p) => !used.has(p.contentHash));
  const pairingConfidence: number[] = [];
  const needsReview: boolean[] = [];
  const warnings: string[] = [];

  for (const unit of units) {
    const frontFace = inferFaceFromFileName(unit.front.fileName ?? unit.front.storageRef);
    const backFace = unit.back
      ? inferFaceFromFileName(unit.back.fileName ?? unit.back.storageRef)
      : "unknown";
    let confidence = method === "filename_front_back" ? 0.95 : 0.85;
    let review = false;

    if (!unit.back) {
      confidence = 0.2;
      review = true;
      warnings.push(`unit ${unit.unitIndex}: missing back — flagged, not guessed`);
    } else if (frontFace === "back" && backFace === "front") {
      confidence = 0.35;
      review = true;
      warnings.push(`unit ${unit.unitIndex}: faces look swapped — flagged`);
    } else if (frontFace === "front" && backFace === "front") {
      confidence = 0.25;
      review = true;
      warnings.push(`unit ${unit.unitIndex}: two fronts labeled — flagged`);
    } else if (unit.front.contentHash === unit.back.contentHash) {
      confidence = 0.15;
      review = true;
      warnings.push(`unit ${unit.unitIndex}: front and back are the same bytes`);
    }

    pairingConfidence.push(confidence);
    needsReview.push(review);
  }

  if (pages.length % 2 === 1 && method === "sequential_duplex") {
    warnings.push("odd page count for sequential duplex — leftover flagged");
  }

  return {
    units,
    orphans,
    warnings,
    method,
    pairingConfidence,
    needsReview,
  };
}

export { inferFaceFromFileName };
export function pageStem(name: string): string {
  return stemKey(name);
}
