import { createHash, randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { markInferred, markObserved } from "@vip/evidence";
import type { DerivedCatalogRow, ParseResult, SourceAdapter } from "./types.js";

export const ADAPTER_VERSION = "clz-adapter@0.1.0";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(node: unknown, ...keys: string[]): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node).trim();
  const obj = asRecord(node);
  for (const key of keys) {
    if (key in obj) {
      const v = obj[key];
      if (typeof v === "string" || typeof v === "number") return String(v).trim();
      if (v && typeof v === "object") {
        const nested = asRecord(v);
        if (typeof nested["#text"] === "string") return nested["#text"].trim();
        if (typeof nested.displayname === "string") return nested.displayname.trim();
        if (typeof nested.displaydate === "string") return nested.displaydate.trim();
        if (typeof nested.date === "string") return nested.date.trim();
        if (typeof nested.rating === "string" || typeof nested.rating === "number") {
          return String(nested.rating).trim();
        }
      }
    }
  }
  if (typeof obj["#text"] === "string") return obj["#text"].trim();
  if (typeof obj.displayname === "string") return obj.displayname.trim();
  return "";
}

function parseFloatSafe(value: string): number {
  const s = value.replace("$", "").replace(/,/g, "").trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function deriveFromClzComic(comic: Record<string, unknown>): DerivedCatalogRow {
  const main = asRecord(comic.mainsection);
  const series = asRecord(main.series);
  const edition = asRecord(comic.edition);
  const grade = asRecord(comic.grade);

  const seriesName = textOf(series, "displayname");
  const title = textOf(main, "title");
  const issue = textOf(comic, "issuenr");
  const issueExt = textOf(comic, "issueext");
  const issueFull = issueExt ? `${issue}${issueExt}` : issue;
  const variant = textOf(edition, "displayname");

  const gradeRatingRaw = parseFloatSafe(textOf(grade, "rating"));
  const slabRaw = textOf(comic, "isslabbed").toLowerCase();
  const slabStatus: DerivedCatalogRow["slabStatus"] =
    slabRaw === "raw"
      ? "raw"
      : slabRaw === "yes" || slabRaw === "slabbed"
        ? "slabbed"
        : slabRaw
          ? "pending"
          : null;

  // VIP rule: 0.0 → null grade + NM inferred · unverified — never a fake number
  const isZeroOrMissing = !gradeRatingRaw || gradeRatingRaw === 0;
  const gradeRating = isZeroOrMissing ? null : gradeRatingRaw;
  const nmAssumed = slabStatus === "raw" && isZeroOrMissing;

  const canonicalName = [seriesName || title, issueFull && `#${issueFull}`, variant]
    .filter(Boolean)
    .join(" ");

  return {
    sourceRowId: textOf(comic, "hash") || randomUUID(),
    canonicalName: canonicalName || title || "Unknown comic",
    categoryKind: "comic",
    originalFields: JSON.parse(JSON.stringify(comic)) as Record<string, unknown>,
    gradeRating,
    assumedGrade: nmAssumed ? "NM" : gradeRating != null ? String(gradeRating) : null,
    slabStatus,
    quantity: Math.max(1, Math.trunc(parseFloatSafe(textOf(comic, "quantity") || "1") || 1)),
    purchasePrice: (() => {
      const n = parseFloatSafe(textOf(comic, "purchaseprice"));
      return n > 0 ? n : null;
    })(),
    currentPrice: (() => {
      const n = parseFloatSafe(textOf(comic, "currentprice"));
      return n > 0 ? n : null;
    })(),
    gradeInference: nmAssumed
      ? { kind: "nm_assumed", verificationStatus: "unverified" }
      : { kind: "none" },
  };
}

export class ClzXmlAdapter implements SourceAdapter<DerivedCatalogRow> {
  readonly id = "clz_xml";
  readonly contentTypes = ["application/xml", "text/xml"];

  async parse(input: {
    filename: string;
    bytes: Buffer | string;
  }): Promise<ParseResult<DerivedCatalogRow>> {
    const payload = typeof input.bytes === "string" ? input.bytes : input.bytes.toString("utf8");
    const contentHash = createHash("sha256").update(payload).digest("hex");

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      isArray: (name) => name === "comic",
    });
    const doc = parser.parse(payload) as Record<string, unknown>;
    const datafile = asRecord(doc.datafile ?? doc);
    const comiclist = asRecord(datafile.comiclist ?? datafile);
    const comics = ensureArray(comiclist.comic).map(asRecord);

    const records = comics
      .filter((c) => Object.keys(c).length > 0)
      .map((c) => deriveFromClzComic(c));

    return {
      records,
      snapshot: {
        source: this.id,
        contentHash,
        contentType: "application/xml",
        payload,
        byteLength: Buffer.byteLength(payload, "utf8"),
        ingestedAt: new Date(),
        recordCount: records.length,
      },
    };
  }
}

export function snapshotProvenance(source: string) {
  return markObserved({
    source,
    ruleOrModelVersion: ADAPTER_VERSION,
    confidence: 1,
    notes: "Immutable raw import snapshot",
  });
}

export function holdingProvenanceForRow(row: DerivedCatalogRow) {
  if (row.gradeInference.kind === "nm_assumed") {
    return markInferred({
      source: "clz_import",
      ruleOrModelVersion: ADAPTER_VERSION,
      notes: "NM assumed · unverified",
    });
  }
  return markObserved({
    source: "clz_import",
    ruleOrModelVersion: ADAPTER_VERSION,
    confidence: 0.9,
  });
}
