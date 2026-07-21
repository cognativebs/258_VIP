import { createHash } from "node:crypto";
import type { DerivedCatalogRow, ParseResult, SourceAdapter } from "./types.js";

const ADAPTER_VERSION = "tcg-csv-adapter@0.1.0-stub";

/**
 * Stub TCG CSV adapter sharing the Adapter interface.
 * Full column mapping lands when a real export fixture is supplied.
 */
export class TcgCsvAdapter implements SourceAdapter<DerivedCatalogRow> {
  readonly id = "tcg_csv";
  readonly contentTypes = ["text/csv"];

  async parse(input: {
    filename: string;
    bytes: Buffer | string;
  }): Promise<ParseResult<DerivedCatalogRow>> {
    const payload = typeof input.bytes === "string" ? input.bytes : input.bytes.toString("utf8");
    const contentHash = createHash("sha256").update(payload).digest("hex");
    const lines = payload.split(/\r?\n/).filter((l) => l.trim().length > 0);

    // header + rows; stub maps name,set,number,qty if present
    const [headerLine, ...rows] = lines;
    if (!headerLine) {
      return {
        records: [],
        snapshot: {
          source: this.id,
          contentHash,
          contentType: "text/csv",
          payload,
          byteLength: Buffer.byteLength(payload, "utf8"),
          ingestedAt: new Date(),
          recordCount: 0,
        },
      };
    }

    const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());
    const records: DerivedCatalogRow[] = rows.map((line, idx) => {
      const cols = line.split(",").map((c) => c.trim());
      const get = (name: string) => {
        const i = headers.indexOf(name);
        return i >= 0 ? (cols[i] ?? "") : "";
      };
      const name = get("name") || get("card") || `TCG row ${idx + 1}`;
      const set = get("set");
      const number = get("number") || get("no");
      const qty = Number(get("qty") || get("quantity") || "1") || 1;
      return {
        sourceRowId: get("id") || `${set}:${number}:${name}:${idx}`,
        canonicalName: [name, set && `(${set})`, number && `#${number}`].filter(Boolean).join(" "),
        categoryKind: "pokemon",
        originalFields: Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""])),
        gradeRating: null,
        assumedGrade: null,
        slabStatus: "raw",
        quantity: Math.max(1, Math.trunc(qty)),
        purchasePrice: null,
        currentPrice: null,
        gradeInference: { kind: "none" },
      };
    });

    return {
      records,
      snapshot: {
        source: this.id,
        contentHash,
        contentType: "text/csv",
        payload,
        byteLength: Buffer.byteLength(payload, "utf8"),
        ingestedAt: new Date(),
        recordCount: records.length,
      },
    };
  }
}

export { ADAPTER_VERSION as TCG_ADAPTER_VERSION };
