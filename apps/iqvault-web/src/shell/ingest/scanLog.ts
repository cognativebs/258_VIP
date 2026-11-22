/** Newest event is index 0. Selection follows it until the operator picks an older row. */

export type ScanSelection = {
  selectedId: string | null;
  followNewest: boolean;
};

export function nextScanSelection(input: {
  rows: { id: string }[];
  selectedId: string | null;
  followNewest: boolean;
}): ScanSelection {
  const newest = input.rows[0]?.id ?? null;
  const stillThere = input.selectedId != null && input.rows.some((row) => row.id === input.selectedId);
  if (input.followNewest || !stillThere) return { selectedId: newest, followNewest: true };
  return { selectedId: input.selectedId, followNewest: false };
}

export function selectScan(rows: { id: string }[], id: string): ScanSelection {
  return { selectedId: id, followNewest: rows[0]?.id === id };
}

export const SCAN_LOG_VIRTUAL_AFTER = 200;
export const SCAN_LOG_ROW_PX = 40;
export const SCAN_LOG_VIEW_PX = 320;

export function visibleScanRange(count: number, scrollTop: number): { start: number; end: number; virtual: boolean } {
  if (count <= SCAN_LOG_VIRTUAL_AFTER) return { start: 0, end: count, virtual: false };
  const overscan = 6;
  const start = Math.max(0, Math.floor(scrollTop / SCAN_LOG_ROW_PX) - overscan);
  const window = Math.ceil(SCAN_LOG_VIEW_PX / SCAN_LOG_ROW_PX) + overscan * 2;
  return { start, end: Math.min(count, start + window), virtual: true };
}
