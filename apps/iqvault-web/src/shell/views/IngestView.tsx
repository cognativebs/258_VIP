"use client";

import { useEffect, useRef, useState } from "react";
import { StageStrip } from "../components/StageStrip";
import { SCAN_LOG_ROW_PX, visibleScanRange } from "../ingest/scanLog";
import type { IngestActions, IngestFlowModel, IngestScanRow } from "../ingest/types";

const noop = () => undefined;

const ACTIONS: IngestActions = {
  onDestination: noop,
  onSubtargetKind: noop,
  onSubtargetId: noop,
  onMethod: noop,
  onQuery: noop,
  onCreate: noop,
  onOpen: noop,
  onResume: noop,
  onAbandon: noop,
  onBack: noop,
  onCapture: noop,
  onPaste: noop,
  onSelectScan: noop,
  onUndo: noop,
  onConfirmDraft: noop,
  onConfirmUnknown: noop,
  onManual: noop,
  onQueue: noop,
  onCommit: noop,
  onCsvText: noop,
  onCsvPreset: noop,
  onCsvPreview: noop,
  onCsvStore: noop,
};

export function IngestView({
  model,
  actions,
}: {
  model: IngestFlowModel;
  actions?: Partial<IngestActions>;
}) {
  const act = { ...ACTIONS, ...actions };
  return (
    <div className="vip-screen vip-screen-stack">
      <header className="vip-screen-head">
        <div>
          <p className="vip-kicker">Ingest</p>
          <h1>Bring copies in</h1>
        </div>
      </header>
      <p className="vip-muted">
        False auto-confirm rate is not recorded. Auto-confirm threshold is not on the batch.
      </p>
      <StageStrip model={model.detail?.stages} />
      {model.error ? <p role="alert">{model.error}</p> : null}
      {model.detail ? <WorkSurface model={model} act={act} /> : <Chooser model={model} act={act} />}
    </div>
  );
}

function Chooser({ model, act }: { model: IngestFlowModel; act: IngestActions }) {
  const destination = model.destinations.find((item) => item.id === model.destinationId) ?? null;
  const method = model.methods.find((item) => item.key === model.methodKey) ?? null;
  return (
    <div className="vip-ingest-flow">
      <fieldset className="vip-ingest-step">
        <legend>Where is this inventory going?</legend>
        <div className="vip-entry-row">
          {model.destinations.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === model.destinationId ? "vip-button is-on" : "vip-button"}
              aria-pressed={item.id === model.destinationId}
              onClick={() => act.onDestination(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>
      {!destination ? (
        <p>No destination chosen yet. Method and batch steps are not reachable.</p>
      ) : (
        <>
          {destination.id === "personal_collection" ? (
            <div className="vip-entry-row">
              <label>
                Sub-target
                <select
                  value={model.subtargetKind}
                  onChange={(event) => act.onSubtargetKind(event.target.value as "" | "binder" | "hunt")}
                >
                  <option value="">None</option>
                  <option value="binder">Binder</option>
                  <option value="hunt">Hunt</option>
                </select>
              </label>
              {model.subtargetKind === "binder" ? (
                <label>
                  Binder
                  <select value={model.subtargetId} onChange={(event) => act.onSubtargetId(event.target.value)}>
                    <option value="">Choose a binder</option>
                    {model.binders.map((binder) => (
                      <option key={binder.id} value={binder.id}>
                        {binder.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {model.subtargetKind === "hunt" ? (
                <label>
                  Hunt
                  <select value={model.subtargetId} onChange={(event) => act.onSubtargetId(event.target.value)}>
                    <option value="">Choose a hunt</option>
                    {model.hunts.map((hunt) => (
                      <option key={hunt.id} value={hunt.id}>
                        {hunt.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
          <fieldset className="vip-ingest-step">
            <legend>How is it arriving?</legend>
            <div className="vip-entry-row">
              {model.methods.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={item.key === model.methodKey ? "vip-button is-on" : "vip-button"}
                  aria-pressed={item.key === model.methodKey}
                  disabled={!item.enabled}
                  title={item.disabledReason}
                  onClick={() => act.onMethod(item.key)}
                >
                  {item.label}
                  {!item.enabled ? ` · ${item.disabledReason ?? "No sources connected"}` : ""}
                </button>
              ))}
            </div>
          </fieldset>
          {!method ? null : !method.enabled ? (
            <p>No sources connected. API import is not available.</p>
          ) : (
            <BatchPanel model={model} act={act} />
          )}
        </>
      )}
    </div>
  );
}

function BatchPanel({ model, act }: { model: IngestFlowModel; act: IngestActions }) {
  const active = model.batches.some((batch) => batch.lifecycle === "active" && batch.destination === model.destinationId);
  return (
    <section className="vip-ingest-step" aria-label="Batches">
      <h2>New batch, or continue an existing one?</h2>
      {!active ? (
        <p>
          No active batch for this destination.{" "}
          <button type="button" className="vip-button" onClick={act.onCreate}>
            Start a new batch
          </button>
        </p>
      ) : null}
      {model.pausedNotice ? <p role="status">{model.pausedNotice}</p> : null}
      <label>
        Search batches
        <input value={model.query} onChange={(event) => act.onQuery(event.target.value)} />
      </label>
      <ul className="vip-queue">
        {model.batches.map((batch) => (
          <li key={batch.id} className="vip-batch">
            <div>
              <p className="vip-batch-name">{batch.name}</p>
              <p className="vip-muted">
                {batch.destination ?? "destination not recorded"} · {batch.method ?? "method not recorded"} · {batch.lifecycle}
                {batch.stale ? " · Stale · older than 30 days" : ""}
              </p>
              {batch.stale ? <p>Not abandoned automatically.</p> : null}
              {batch.lifecycle === "abandoned" ? <p>{batch.scanUnits} scans preserved</p> : null}
            </div>
            <p>
              {batch.captured} captured · {batch.identified} identified · {batch.review} review
            </p>
            <p className="vip-muted">{batch.lastActivity}</p>
            <div className="vip-entry-row">
              <button type="button" className="vip-button" onClick={() => act.onOpen(batch.id)}>
                Open
              </button>
              {batch.destination && (batch.lifecycle === "paused" || batch.lifecycle === "abandoned") ? (
                <button type="button" className="vip-button" onClick={() => act.onResume(batch.id)}>
                  Resume
                </button>
              ) : null}
              {batch.lifecycle !== "committed" && batch.lifecycle !== "abandoned" ? (
                <button type="button" className="vip-button" onClick={() => act.onAbandon(batch.id)}>
                  Abandon
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WorkSurface({ model, act }: { model: IngestFlowModel; act: IngestActions }) {
  const detail = model.detail;
  const captureRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    captureRef.current?.focus();
  }, [detail?.sessionCount, model.captureError]);
  if (!detail) return null;
  const scanner = detail.methodKey === "scanner_hid" || detail.methodKey === "scanner_batch";
  const image = detail.methodKey === "image_capture" || detail.methodKey === "file_upload";
  const selected = detail.rows.find((row) => row.id === detail.selectedId) ?? detail.rows[0] ?? null;
  return (
    <div>
      <p>
        {detail.destinationLabel} · {detail.methodLabel} · {detail.lifecycle}
      </p>
      <button type="button" className="vip-button" onClick={act.onBack}>
        Back to batches
      </button>
      <p>Session {detail.sessionCount}</p>
      <p>Batch total {detail.batchTotal}</p>
      {detail.methodNote ? <p>{detail.methodNote}</p> : null}
      {scanner ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const field = captureRef.current;
            if (!field) return;
            const value = field.value;
            field.value = "";
            if (value.includes("\n")) act.onPaste(value);
            else act.onCapture(value);
          }}
        >
          <label>
            Scan or paste codes
            <input ref={captureRef} name="code" autoFocus aria-label="Scan or paste codes" />
          </label>
          <button type="submit" className="vip-button">
            Add
          </button>
          <button
            type="button"
            className="vip-button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={act.onUndo}
            disabled={!detail.rows.some((row) => !row.voided)}
          >
            Undo last
          </button>
        </form>
      ) : null}
      {model.captureError ? <p role="alert">{model.captureError}</p> : null}
      {model.duplicateNotice ? <p role="status">{model.duplicateNotice}</p> : null}
      {detail.methodKey === "manual" ? <ManualForm act={act} /> : null}
      {image ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            act.onQueue(String(data.get("names") ?? ""));
            event.currentTarget.reset();
          }}
        >
          <label>
            Image file names, one per line
            <textarea name="names" aria-label="Image file names" />
          </label>
          <p>Queued. Identification is not connected.</p>
          <button type="submit" className="vip-button">
            Queue names
          </button>
        </form>
      ) : null}
      {detail.methodKey === "csv_import" ? <CsvPanel model={model} act={act} /> : null}
      {scanner ? (
        <div className="vip-scan-layout">
          <ScanLog rows={detail.rows} selectedId={selected?.id ?? null} onSelect={act.onSelectScan} />
          <ScanDetail row={selected} draft={model.confirmDraft} act={act} />
        </div>
      ) : (
        <ul className="vip-queue">
          {detail.rows.map((row) => (
            <li key={row.id}>
              {row.label} · qty {row.quantity}
              {row.review ? ` · review · ${row.reason ?? "Needs a decision"}` : ""}
            </li>
          ))}
        </ul>
      )}
      {detail.stages.review > 0 ? <p>Review items block a full commit.</p> : null}
      <div className="vip-entry-row">
        <button
          type="button"
          className="vip-button"
          disabled={!detail.stages.commitEnabled}
          onClick={() => act.onCommit(false)}
        >
          Commit
        </button>
        {detail.stages.partialAvailable ? (
          <button type="button" className="vip-button" onClick={() => act.onCommit(true)}>
            Commit ready rows
          </button>
        ) : null}
        {detail.lifecycle !== "abandoned" && detail.lifecycle !== "committed" ? (
          <button type="button" className="vip-button" onClick={() => act.onAbandon(detail.id)}>
            Abandon
          </button>
        ) : null}
      </div>
      {detail.stages.partialAvailable ? <p>Review items stay in the batch.</p> : null}
      {model.commitNote ? <p role="status">{model.commitNote}</p> : null}
    </div>
  );
}

function ScanLog({
  rows,
  selectedId,
  onSelect,
}: {
  rows: IngestScanRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const range = visibleScanRange(rows.length, scrollTop);
  const slice = rows.slice(range.start, range.end);
  if (!range.virtual) {
    return (
      <ul className="vip-scan-log" aria-label="Scan events">
        {rows.map((row) => (
          <li key={row.id}>
            <ScanEventButton row={row} selected={row.id === selectedId} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div
      className="vip-scan-log"
      data-virtualized="true"
      aria-label="Scan events"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ position: "relative", height: rows.length * SCAN_LOG_ROW_PX }}>
        {slice.map((row, index) => (
          <div
            key={row.id}
            style={{
              position: "absolute",
              top: (range.start + index) * SCAN_LOG_ROW_PX,
              height: SCAN_LOG_ROW_PX,
              left: 0,
              right: 0,
            }}
          >
            <ScanEventButton row={row} selected={row.id === selectedId} onSelect={onSelect} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ScanEventButton({
  row,
  selected,
  onSelect,
}: {
  row: IngestScanRow;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`vip-button vip-scan-row${selected ? " is-on" : ""}${row.voided ? " is-voided" : ""}`}
      aria-current={selected ? "true" : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(row.id)}
    >
      {row.label} · rollup {row.quantity}
      {row.voided ? " · voided" : ""}
      {row.review && !row.voided ? ` · review · ${row.reason ?? "Needs a decision"}` : ""}
    </button>
  );
}

function ScanDetail({
  row,
  draft,
  act,
}: {
  row: IngestScanRow | null;
  draft: string;
  act: IngestActions;
}) {
  if (!row) return <aside aria-label="Selected scan">No scan selected.</aside>;
  return (
    <aside className="vip-scan-detail" aria-label="Selected scan">
      <p>{row.label}</p>
      <p>{row.productLabel ?? "No product name"}</p>
      <p>Rollup quantity {row.quantity}</p>
      <p>{row.createdAt}</p>
      {row.voided ? <p>Voided. Excluded from the rollup.</p> : null}
      {row.reason && !row.voided ? <p>{row.reason}</p> : null}
      {row.review && !row.voided ? (
        <form
          className="vip-inline-confirm"
          onSubmit={(event) => {
            event.preventDefault();
            act.onConfirmUnknown();
          }}
        >
          <p>Unknown GTIN {row.label}. Confirm the product inline.</p>
          <label>
            Product name
            <input
              value={draft}
              onChange={(event) => act.onConfirmDraft(event.target.value)}
              aria-label="Product name"
            />
          </label>
          <button type="submit" className="vip-button" onMouseDown={(event) => event.preventDefault()}>
            Confirm product
          </button>
        </form>
      ) : null}
    </aside>
  );
}

function ManualForm({ act }: { act: IngestActions }) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        act.onManual({
          productLabel: String(data.get("productLabel") ?? ""),
          quantity: String(data.get("quantity") ?? "1"),
          costBasis: String(data.get("costBasis") ?? ""),
          acquiredOn: String(data.get("acquiredOn") ?? ""),
        });
        event.currentTarget.reset();
      }}
    >
      <label>
        Product
        <input name="productLabel" required aria-label="Manual product" />
      </label>
      <label>
        Quantity
        <input name="quantity" defaultValue="1" aria-label="Manual quantity" />
      </label>
      <label>
        Cost basis
        <input name="costBasis" aria-label="Cost basis" />
      </label>
      <label>
        Acquired on
        <input name="acquiredOn" placeholder="YYYY-MM-DD" aria-label="Acquired on" />
      </label>
      <button type="submit" className="vip-button">
        Add row
      </button>
    </form>
  );
}

function CsvPanel({ model, act }: { model: IngestFlowModel; act: IngestActions }) {
  return (
    <section aria-label="CSV column map">
      <label>
        Preset
        <select
          value={model.csvPresetId ?? ""}
          onChange={(event) => act.onCsvPreset(event.target.value)}
          aria-label="CSV preset"
        >
          <option value="">Choose a preset</option>
          {model.presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        CSV
        <textarea
          value={model.csvText}
          onChange={(event) => act.onCsvText(event.target.value)}
          aria-label="CSV text"
        />
      </label>
      <button type="button" className="vip-button" onClick={act.onCsvPreview}>
        Preview map
      </button>
      {model.csv ? (
        <div>
          <p>Preset {model.csv.presetLabel} applied.</p>
          <p>Headers: {model.csv.headers.join(", ")}</p>
          <ul>
            {model.csv.mapped.map((entry) => (
              <li key={entry.field}>
                {entry.field} → {entry.column ?? "unmapped"}
              </li>
            ))}
          </ul>
          <p>{model.csv.duplicates} existing inventory rows match an imported id.</p>
          <button type="button" className="vip-button" onClick={act.onCsvStore}>
            Store rows
          </button>
        </div>
      ) : null}
    </section>
  );
}
