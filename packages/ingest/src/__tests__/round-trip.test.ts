import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ClzXmlAdapter,
  DerivedStore,
  fingerprintDerived,
  holdingProvenanceForRow,
  ImmutableSnapshotStore,
  TcgCsvAdapter,
} from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "clz-sample.xml");

describe("ClzXmlAdapter", () => {
  it("maps grade 0.0 raw to null + NM assumed · unverified", async () => {
    const xml = readFileSync(fixturePath, "utf8");
    const adapter = new ClzXmlAdapter();
    const result = await adapter.parse({ filename: "clz-sample.xml", bytes: xml });
    expect(result.records.length).toBeGreaterThan(0);
    for (const row of result.records) {
      expect(row.gradeRating).toBeNull();
      expect(row.assumedGrade).toBe("NM");
      expect(row.gradeInference).toEqual({
        kind: "nm_assumed",
        verificationStatus: "unverified",
      });
      const p = holdingProvenanceForRow(row);
      expect(p.method).toBe("inferred");
      expect(p.verificationStatus).toBe("unverified");
      expect(p.notes).toContain("NM assumed");
    }
  });

  it("preserves original CLZ fields on each record", async () => {
    const xml = readFileSync(fixturePath, "utf8");
    const adapter = new ClzXmlAdapter();
    const result = await adapter.parse({ filename: "clz-sample.xml", bytes: xml });
    const first = result.records[0];
    expect(first?.originalFields).toBeTruthy();
    expect(first?.originalFields.hash || first?.sourceRowId).toBeTruthy();
  });
});

describe("Phase 1 gate — round-trip regen", () => {
  it("import → snapshot → delete derived → regenerate identical", async () => {
    const xml = readFileSync(fixturePath, "utf8");
    const adapter = new ClzXmlAdapter();
    const snapshots = new ImmutableSnapshotStore();
    const derived = new DerivedStore();

    const first = await adapter.parse({ filename: "clz-sample.xml", bytes: xml });
    const snap = snapshots.insert(first.snapshot);
    derived.replaceAll(first.records);
    const fingerprintA = fingerprintDerived(derived.list());

    // Delete all derived rows
    derived.clear();
    expect(derived.list()).toHaveLength(0);

    // Snapshots must be immutable
    expect(() => snapshots.update(snap.id, { recordCount: 0 })).toThrow(/immutable/i);

    // Regenerate from immutable snapshot payload
    const payload = snapshots.get(snap.id)?.payload;
    expect(payload).toBeTruthy();
    const second = await adapter.parse({
      filename: "clz-sample.xml",
      bytes: payload!,
    });
    expect(second.snapshot.contentHash).toBe(snap.contentHash);
    derived.replaceAll(second.records);
    const fingerprintB = fingerprintDerived(derived.list());

    expect(fingerprintB).toBe(fingerprintA);
  });
});

describe("TcgCsvAdapter stub", () => {
  it("shares Adapter interface and snapshots input", async () => {
    const csv = "name,set,number,qty\nPikachu,Base,58,2\n";
    const adapter = new TcgCsvAdapter();
    const result = await adapter.parse({ filename: "demo.csv", bytes: csv });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.categoryKind).toBe("pokemon");
    expect(result.snapshot.contentHash).toHaveLength(64);
  });
});
