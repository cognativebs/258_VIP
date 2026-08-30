import { createHash } from "node:crypto";
import type { DeviceAdapter, DevicePage, FolderWatchConfig } from "./types.js";
import { RICOH_FI8170_DEVICE } from "../constants.js";
import type { ScanBatchInput, ScanUnitInput } from "../schemas.js";

/**
 * PaperStream / folder-drop adapter for Ricoh fi-8170.
 *
 * Does not drive the scanner hardware directly — that stays in PaperStream
 * Capture (or equivalent). This adapter turns a list of dropped page descriptors
 * into duplex units for the VIP intake pipeline.
 */
export class FolderWatchAdapter implements DeviceAdapter {
  readonly id = "ricoh-fi8170-folder";
  readonly label = "Ricoh fi-8170 PaperStream folder drop";
  readonly deviceModel = RICOH_FI8170_DEVICE;

  private pages: DevicePage[] = [];

  constructor(private readonly config: FolderWatchConfig) {}

  /** Inject pages (tests / watcher daemon). */
  ingestDescriptors(
    files: Array<{
      fileName: string;
      storageRef?: string;
      bytes?: Buffer | Uint8Array | string;
      contentHash?: string;
      ocrText?: string | null;
      mimeType?: string;
    }>,
  ): DevicePage[] {
    const now = new Date();
    const added: DevicePage[] = [];
    for (const [i, file] of files.entries()) {
      const contentHash =
        file.contentHash ??
        createHash("sha256")
          .update(
            typeof file.bytes === "string"
              ? file.bytes
              : file.bytes ?? file.fileName,
          )
          .digest("hex");
      const storageRef =
        file.storageRef ?? `${this.config.rootLabel}/${file.fileName}`;
      const face = inferFaceFromFileName(file.fileName);
      const page: DevicePage = {
        storageRef,
        contentHash,
        mimeType: file.mimeType ?? mimeFromName(file.fileName),
        byteLength:
          typeof file.bytes === "string"
            ? Buffer.byteLength(file.bytes)
            : file.bytes?.byteLength,
        face,
        ocrText: file.ocrText ?? null,
        fileName: file.fileName,
        discoveredAt: now,
        sequence: this.pages.length + i,
      };
      added.push(page);
    }
    this.pages.push(...added);
    return added;
  }

  async listPages(): Promise<DevicePage[]> {
    return [...this.pages];
  }

  clear(): void {
    this.pages = [];
  }
}

export function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export function inferFaceFromFileName(
  fileName: string,
): "front" | "back" | "unknown" {
  const base = fileName.toLowerCase();
  if (/(^|[_\-.])(front|f|recto)([_\-.]|$)/.test(base)) return "front";
  if (/(^|[_\-.])(back|b|verso)([_\-.]|$)/.test(base)) return "back";
  return "unknown";
}

/**
 * Pair ADF pages into card units.
 * sequential_duplex: ADF order as front then back (face-down load).
 * sequential_duplex_back_first: ADF order as back then front (face-up load).
 * filename_front_back: group by stem, prefer explicit front/back labels.
 */
export function pairPagesIntoUnits(
  pages: DevicePage[],
  strategy: FolderWatchConfig["pairing"] = "sequential_duplex",
  categoryHint?: ScanBatchInput["categoryHint"],
): ScanUnitInput[] {
  const ordered = [...pages].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
  );

  if (strategy === "filename_front_back") {
    return pairByFileName(ordered, categoryHint);
  }
  return pairSequentialDuplex(
    ordered,
    categoryHint,
    strategy === "sequential_duplex_back_first",
  );
}

function pairSequentialDuplex(
  pages: DevicePage[],
  categoryHint?: ScanBatchInput["categoryHint"],
  backFirst = false,
): ScanUnitInput[] {
  const units: ScanUnitInput[] = [];
  for (let i = 0; i < pages.length; i += 2) {
    const first = pages[i]!;
    const second = pages[i + 1];
    const front = backFirst && second ? second : first;
    const back = backFirst && second ? first : second;
    units.push({
      unitIndex: units.length,
      front: {
        ...front,
        face: front.face === "unknown" ? "front" : front.face,
      },
      back: back
        ? { ...back, face: back.face === "unknown" ? "back" : back.face }
        : undefined,
      categoryHint: categoryHint ?? null,
    });
  }
  return units;
}

function pairByFileName(
  pages: DevicePage[],
  categoryHint?: ScanBatchInput["categoryHint"],
): ScanUnitInput[] {
  const groups = new Map<string, DevicePage[]>();
  for (const page of pages) {
    const stem = stemKey(page.fileName ?? page.storageRef);
    const list = groups.get(stem) ?? [];
    list.push(page);
    groups.set(stem, list);
  }

  const units: ScanUnitInput[] = [];
  for (const group of groups.values()) {
    const front =
      group.find((p) => p.face === "front") ??
      group.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))[0]!;
    const back =
      group.find((p) => p.face === "back" && p.contentHash !== front.contentHash) ??
      group.find((p) => p.contentHash !== front.contentHash);
    units.push({
      unitIndex: units.length,
      front: { ...front, face: "front" },
      back: back ? { ...back, face: "back" } : undefined,
      categoryHint: categoryHint ?? null,
    });
  }
  return units;
}

export function stemKey(name: string): string {
  const base = name.split("/").pop() ?? name;
  return base
    .replace(/\.(jpe?g|png|tiff?|webp)$/i, "")
    .replace(/[_\-.]?(front|back|f|b|recto|verso)$/i, "")
    .toLowerCase();
}

/** Build a ScanBatchInput from adapter pages. */
export function batchInputFromPages(
  pages: DevicePage[],
  opts: {
    pairing?: FolderWatchConfig["pairing"];
    categoryHint?: ScanBatchInput["categoryHint"];
    notes?: string;
    tenantId?: string | null;
    device?: string;
  } = {},
): ScanBatchInput {
  const units = pairPagesIntoUnits(
    pages,
    opts.pairing ?? "sequential_duplex",
    opts.categoryHint,
  );
  return {
    device: opts.device?.trim() || RICOH_FI8170_DEVICE,
    purpose: "inventory_intake",
    qualityTier: "intake",
    categoryHint: opts.categoryHint ?? null,
    tenantId: opts.tenantId ?? null,
    notes: opts.notes,
    units,
  };
}
