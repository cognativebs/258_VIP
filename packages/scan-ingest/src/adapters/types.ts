import type { ScanBatchInput, ScanPageInput } from "../schemas.js";

/**
 * Swappable device input seam (AGENTS.md rule 5).
 * Ricoh fi-8170 typically lands pages via PaperStream Capture → watched folder.
 * Future: SANE / TWAIN / ISIS SDK adapters without changing core pipeline.
 */
export type DevicePage = ScanPageInput & {
  discoveredAt: Date;
  sequence?: number;
};

export type DeviceAdapter = {
  id: string;
  label: string;
  deviceModel: string;
  /** List newly available pages (idempotent by contentHash). */
  listPages: () => Promise<DevicePage[]>;
};

export type PairingStrategy =
  | "sequential_duplex"
  | "sequential_duplex_back_first"
  | "filename_front_back";

export type FolderWatchConfig = {
  /** Logical root used in storageRef prefixes (not necessarily a real FS path in tests). */
  rootLabel: string;
  pairing: PairingStrategy;
  categoryHint?: ScanBatchInput["categoryHint"];
};
