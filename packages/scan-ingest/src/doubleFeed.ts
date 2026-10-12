/**
 * Cards stuck together in the Ricoh feed scan as one oversized image: the second card sticks out
 * past the first (batch ed919c12 unit 0045 was 1562×2214 against ~1488×2080 for single cards).
 * A front clearly larger than the batch's typical size is a possible double feed. It routes the
 * card to review; it never changes the identification.
 */
export const DOUBLE_FEED_RULE = "double-feed-size@0.1.0";

export type ScanSize = { key: string; width: number | null; height: number | null };

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Keys whose size is more than `tolerance` (default 3%) above the batch median on either side. */
export function doubleFeedSuspects(sizes: ReadonlyArray<ScanSize>, tolerance = 0.03): Map<string, string> {
  const known = sizes.filter((s): s is ScanSize & { width: number; height: number } => Boolean(s.width && s.height));
  const out = new Map<string, string>();
  // Too few scans to know what "typical" is.
  if (known.length < 4) return out;
  const w = median(known.map((s) => s.width));
  const h = median(known.map((s) => s.height));
  for (const s of known) {
    if (s.width > w * (1 + tolerance) || s.height > h * (1 + tolerance)) {
      out.set(
        s.key,
        `possible double feed: ${s.width}×${s.height} vs typical ${Math.round(w)}×${Math.round(h)} — two cards may be stuck together (${DOUBLE_FEED_RULE})`,
      );
    }
  }
  return out;
}
