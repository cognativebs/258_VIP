import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StageStripModel } from "../components/StageStrip";
import { IngestView } from "../views/IngestView";
import type { IngestFlowModel, IngestScanRow } from "./types";

const stages = (patch: Partial<StageStripModel> = {}): StageStripModel => ({
  capture: "current",
  identified: 1,
  captured: 2,
  review: 1,
  commitEnabled: false,
  partialAvailable: true,
  ...patch,
});

function model(patch: Partial<IngestFlowModel> = {}): IngestFlowModel {
  return {
    error: null,
    destinationId: "personal_collection",
    destinations: [
      { id: "personal_collection", label: "Personal Collection" },
      { id: "investment_vault", label: "Investment" },
      { id: "dealer_inventory", label: "Dealer Inventory" },
    ],
    subtargetKind: "",
    subtargetId: "",
    binders: [],
    hunts: [],
    methodKey: "scanner_hid",
    methods: [
      { key: "scanner_hid", label: "Scanner (live)", enabled: true },
      { key: "api_import", label: "API import", enabled: false, disabledReason: "No sources connected" },
      { key: "csv_import", label: "CSV / file import", enabled: true },
    ],
    query: "",
    batches: [],
    pausedNotice: null,
    detail: null,
    captureError: null,
    duplicateNotice: null,
    confirmDraft: "",
    commitNote: null,
    csvText: "Series,Quantity\nBatman,1\n",
    csvPresetId: "clz",
    presets: [{ id: "clz", label: "CLZ" }],
    csv: null,
    ...patch,
  };
}

function scan(patch: Partial<IngestScanRow> & Pick<IngestScanRow, "id" | "label">): IngestScanRow {
  return {
    productLabel: null,
    quantity: 1,
    review: false,
    reason: null,
    voided: false,
    createdAt: "2026-09-23 14:00:00",
    ...patch,
  };
}

function capture(patch: Partial<NonNullable<IngestFlowModel["detail"]>> = {}): NonNullable<IngestFlowModel["detail"]> {
  return {
    id: "b1",
    name: "scan",
    destinationLabel: "Personal Collection",
    lifecycle: "active",
    methodKey: "scanner_hid",
    methodLabel: "Scanner (live)",
    stages: stages(),
    rows: [],
    methodNote: null,
    sessionCount: 0,
    batchTotal: 0,
    selectedId: null,
    ...patch,
  };
}

function html(patch: Partial<IngestFlowModel> = {}) {
  return renderToStaticMarkup(<IngestView model={model(patch)} />);
}

describe("ingest required states", () => {
  it("hides method and batch until a destination is chosen", () => {
    const page = html({ destinationId: null, methodKey: null });
    assert.match(page, /No destination chosen yet/);
    assert.match(page, /Method and batch steps are not reachable/);
    assert.doesNotMatch(page, /How is it arriving/);
    assert.match(page, /Review/);
    assert.match(page, /blocked/);
  });

  it("prompts for a new batch when the destination has none active", () => {
    const page = html();
    assert.match(page, /Start a new batch/);
    assert.match(page, /No active batch for this destination/);
  });

  it("appends every scan, newest first, with session and batch totals", () => {
    const page = html({
      detail: capture({
        stages: stages({ review: 0, captured: 2, identified: 2, commitEnabled: true, partialAvailable: false }),
        rows: [
          scan({ id: "new", label: "newest-code", quantity: 1 }),
          scan({ id: "old", label: "older-code", quantity: 1 }),
        ],
        sessionCount: 1,
        batchTotal: 2,
        selectedId: "new",
      }),
    });
    assert.match(page, /Session 1/);
    assert.match(page, /Batch total 2/);
    assert.ok(page.indexOf("newest-code") < page.indexOf("older-code"));
    assert.match(page, /tabindex="-1"/);
    assert.match(page, /2 \/ 2/);
  });

  it("confirms an unknown GTIN on the selected row without a modal", () => {
    const page = html({
      detail: capture({
        rows: [scan({ id: "r1", label: "00036000291452", review: true, reason: "Unknown GTIN" })],
        selectedId: "r1",
        sessionCount: 1,
        batchTotal: 1,
      }),
    });
    assert.match(page, /Unknown GTIN 00036000291452/);
    assert.match(page, /Confirm the product inline/);
    assert.doesNotMatch(page, /dialog/);
  });

  it("shows a failed checksum reason", () => {
    const page = html({
      captureError: "Check digit does not match.",
      detail: capture({
        stages: stages({ review: 0, commitEnabled: false, partialAvailable: false, captured: 0, identified: 0 }),
      }),
    });
    assert.match(page, /Check digit does not match/);
  });

  it("keeps a duplicate as its own row and shows the derived quantity", () => {
    const page = html({
      duplicateNotice: "Duplicate 00036000291452. Quantity is now 2.",
      detail: capture({
        stages: stages({ review: 0, commitEnabled: true, partialAvailable: false }),
        rows: [
          scan({ id: "second", label: "00036000291452", quantity: 2 }),
          scan({ id: "first", label: "00036000291452", quantity: 2 }),
        ],
        selectedId: "second",
        sessionCount: 2,
        batchTotal: 2,
      }),
    });
    assert.match(page, /Quantity is now 2/);
    assert.equal(page.match(/00036000291452/g)?.length, 4);
  });

  it("voids the last scan in the log instead of removing it", () => {
    const page = html({
      detail: capture({
        rows: [
          scan({ id: "last", label: "00036000291452", quantity: 1, voided: true }),
          scan({ id: "kept", label: "00036000291453", quantity: 1 }),
        ],
        selectedId: "last",
        sessionCount: 1,
        batchTotal: 1,
      }),
    });
    assert.match(page, /voided/);
    assert.match(page, /Excluded from the rollup/);
    assert.match(page, /Undo last/);
    assert.match(page, /00036000291453/);
  });

  it("virtualizes a long scan log", () => {
    const rows = Array.from({ length: 201 }, (_, index) => scan({ id: `s${index}`, label: `scan-${index}` }));
    const page = html({
      detail: capture({
        rows,
        selectedId: "s0",
        sessionCount: 1,
        batchTotal: 201,
      }),
    });
    assert.match(page, /data-virtualized="true"/);
    assert.match(page, /scan-0/);
    assert.doesNotMatch(page, /scan-200/);
  });

  it("blocks commit while review items remain and offers a partial commit", () => {
    const page = html({
      detail: capture({
        destinationLabel: "Dealer Inventory",
        rows: [scan({ id: "r1", label: "Unknown", quantity: 1, review: true, reason: "Needs a decision" })],
        selectedId: "r1",
        sessionCount: 1,
        batchTotal: 2,
      }),
      commitNote: "Review items stay in the batch.",
    });
    assert.match(page, /Review items block a full commit/);
    assert.match(page, /Commit ready rows/);
    assert.match(page, /Review items stay in the batch/);
    assert.match(page, /disabled/);
  });

  it("keeps an abandoned batch and its scan count in the panel", () => {
    const page = html({
      batches: [
        {
          id: "ed919c12-4634-439f-b7b6-28d98fa328f3",
          name: "ricoh_fi8170",
          destination: "personal_collection",
          method: null,
          lifecycle: "abandoned",
          captured: 25,
          identified: 0,
          review: 25,
          scanUnits: 25,
          lastActivity: "2026-09-07",
          stale: false,
        },
      ],
    });
    assert.match(page, /abandoned/);
    assert.match(page, /25 scans preserved/);
    assert.match(page, /method not recorded/);
  });

  it("marks a batch older than 30 days without abandoning it", () => {
    const page = html({
      batches: [
        {
          id: "old",
          name: "August intake",
          destination: "personal_collection",
          method: null,
          lifecycle: "paused",
          captured: 4,
          identified: 0,
          review: 0,
          scanUnits: 4,
          lastActivity: "2026-08-01",
          stale: true,
        },
      ],
    });
    assert.match(page, /Stale · older than 30 days/);
    assert.match(page, /Not abandoned automatically/);
  });

  it("disables API import and says no sources are connected", () => {
    const page = html({ methodKey: null });
    assert.match(page, /API import/);
    assert.match(page, /No sources connected/);
    assert.match(page, /disabled/);
  });

  it("shows a CSV preset column map", () => {
    const page = html({
      methodKey: "csv_import",
      csv: {
        presetLabel: "CLZ",
        headers: ["Series", "Quantity", "Barcode"],
        mapped: [
          { field: "name", column: "Series" },
          { field: "barcode", column: "Barcode" },
        ],
        duplicates: 3,
      },
      detail: {
        id: "b1",
        name: "csv",
        destinationLabel: "Personal Collection",
        lifecycle: "active",
        methodKey: "csv_import",
        methodLabel: "CSV / file import",
        stages: stages({ review: 1, captured: 1, identified: 0, commitEnabled: false, partialAvailable: false }),
        rows: [],
        methodNote: null,
        sessionCount: 0,
        batchTotal: 0,
        selectedId: null,
      },
    });
    assert.match(page, /Preset CLZ applied/);
    assert.match(page, /Series/);
    assert.match(page, /name → Series/);
    assert.match(page, /3 existing inventory rows/);
  });
});
