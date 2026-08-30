import type { DevicePage, PairingStrategy } from "./adapters/types.js";
import { inferFaceFromFileName, pairPagesIntoUnits, stemKey } from "./adapters/folder-watch.js";
import type { ScanCategory, ScanUnitInput } from "./schemas.js";

export type PairingMethod =
  | "sequential_duplex"
  | "sequential_duplex_back_first"
  | "filename_front_back"
  | "auto";

export type PairingDecision = {
  units: ScanUnitInput[];
  orphans: DevicePage[];
  warnings: string[];
  method: PairingMethod;
  pairingConfidence: number[];
  needsReview: boolean[];
};

/** Operator-asserted face swap. Does not invent a missing side. */
export function swapUnitFaces(unit: ScanUnitInput): ScanUnitInput {
  if (!unit.back) return unit;
  return {
    ...unit,
    front: { ...unit.back, face: "front" },
    back: { ...unit.front, face: "back" },
  };
}

/**
 * Deterministic pairing. Ambiguous pairs are flagged — never guessed.
 * sequential_duplex = ADF front then back (face-down).
 * sequential_duplex_back_first = ADF back then front (face-up).
 * filename_front_back = stem + front/back labels.
 * auto = filename when most pages are labeled, else sequential (front first).
 */
export function pairPagesForReview(
  pages: DevicePage[],
  opts: {
    strategy?: PairingMethod;
    categoryHint?: ScanCategory | null;
  } = {},
): PairingDecision {
  const strategy = opts.strategy ?? "auto";
  const labeled = pages.filter((p) => inferFaceFromFileName(p.fileName ?? p.storageRef) !== "unknown");
  let method: PairingDecision["method"] =
    strategy === "auto"
      ? labeled.length >= Math.ceil(pages.length * 0.5)
        ? "filename_front_back"
        : "sequential_duplex"
      : strategy;
  const pairStrategy: PairingStrategy =
    method === "sequential_duplex_back_first"
      ? "sequential_duplex_back_first"
      : method === "filename_front_back"
        ? "filename_front_back"
        : "sequential_duplex";

  let units = pairPagesIntoUnits(pages, pairStrategy, opts.categoryHint ?? null);
  const missingBacks = units.filter((u) => !u.back).length;
  // PaperStream often writes IMG_0001.jpg, IMG_0002.jpg with no front/back
  // token. Filename grouping then creates one card per image → all LOW.
  let fellBackToSequential = false;
  if (
    method === "filename_front_back" &&
    pages.length >= 2 &&
    pages.length % 2 === 0 &&
    missingBacks >= Math.ceil(units.length / 2)
  ) {
    fellBackToSequential = true;
    method = "sequential_duplex";
    units = pairPagesIntoUnits(pages, "sequential_duplex", opts.categoryHint ?? null);
  }
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

  if (
    pages.length % 2 === 1 &&
    (method === "sequential_duplex" || method === "sequential_duplex_back_first")
  ) {
    warnings.push("odd page count for sequential duplex — leftover flagged");
  }
  if (method === "sequential_duplex_back_first") {
    warnings.push(
      "face-up ADF: first image treated as back, second as front — operator-selected, not guessed",
    );
  }
  if (fellBackToSequential) {
    warnings.push(
      "filenames were not *_front/*_back — paired as sequential duplex (ADF order, face-down)",
    );
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
