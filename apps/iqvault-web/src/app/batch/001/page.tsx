"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiGet, apiPost } from "@/lib/api";

type FailureClass =
  | "identity"
  | "pricing"
  | "inventory"
  | "disposition"
  | "listing"
  | "workflow";

const FAILURES: FailureClass[] = [
  "identity",
  "pricing",
  "inventory",
  "disposition",
  "listing",
  "workflow",
];

type Item = {
  slot: number;
  roster: {
    fileStem: string;
    expected: { displayName: string; parallel: string | null };
    intendedAskBandUsd: { low: number; high: number };
    messFlags: string[];
  };
  result: {
    identity: { displayName: string | null; confidence: number | null };
    inventoryBucket: string | null;
    liveRange: { label: string } | null;
    disposition: { action: string; notes: string } | null;
    listing: { status: string | null; title: string | null; submitReady: boolean } | null;
    softwareFlags: FailureClass[];
    softwareFlagNotes: string[];
    stagesCompleted: string[];
  } | null;
  inspection: {
    failureClasses: FailureClass[];
    notes: string;
    humanSeconds: number;
    inspector: string | null;
  } | null;
};

type BatchRun = {
  id: string;
  label: string;
  status: string;
  sportsCount: number;
  comicsCount: number;
  items: Item[];
};

export default function Batch001Page() {
  const [run, setRun] = useState<BatchRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState(1);
  const [classes, setClasses] = useState<FailureClass[]>([]);
  const [notes, setNotes] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [timing, setTiming] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const data = await apiGet<BatchRun>("/api/batch/001");
    setRun(data);
  }, []);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [reload]);

  useEffect(() => {
    if (timing == null) return;
    const id = window.setInterval(() => {
      setSeconds(Math.round((Date.now() - timing) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [timing]);

  const current = useMemo(
    () => run?.items.find((i) => i.slot === slot) ?? run?.items[0],
    [run, slot],
  );

  useEffect(() => {
    if (!current) return;
    setClasses(current.inspection?.failureClasses ?? current.result?.softwareFlags ?? []);
    setNotes(current.inspection?.notes ?? current.result?.softwareFlagNotes.join("; ") ?? "");
    setSeconds(current.inspection?.humanSeconds ?? 0);
    setTiming(null);
  }, [current?.slot]);

  async function runSports() {
    setBusy(true);
    setError(null);
    try {
      const data = await apiPost<BatchRun>("/api/batch/001/sports/run", {}, 120_000);
      setRun(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveInspect(e: React.FormEvent) {
    e.preventDefault();
    if (!current) return;
    setBusy(true);
    try {
      const data = await apiPost<BatchRun>(`/api/batch/001/items/${current.slot}/inspect`, {
        slot: current.slot,
        failureClasses: classes,
        notes,
        humanSeconds: seconds,
        inspector: "Gregory",
      });
      setRun(data);
      setTiming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inspect save failed");
    } finally {
      setBusy(false);
    }
  }

  const inspected = run?.items.filter((i) => i.inspection).length ?? 0;
  const moneyFails = run?.items.filter((i) => (i.inspection?.failureClasses.length ?? 0) > 0).length ?? 0;

  return (
    <div className="shell">
      <Nav active="/batch/001" />
      <h1 className="page-title">Batch 001 — sports first</h1>
      <p className="page-sub">
        25 messy Dealer Inventory sports cards through ingest → identify → bucket →
        LIVE → disposition → eBay-ready. Inspect every row. Record only
        money-affecting failures and elapsed human seconds. Comics (10) wait.
        LIVE is Browse listings · unverified — never sold.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <div className="panel" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Status: {run?.status ?? "…"} · Sports {run?.sportsCount ?? 25} · Comics{" "}
          {run?.comicsCount ?? 10} pending · Inspected {inspected}/25 · Money
          failures {moneyFails}
        </p>
        <button type="button" onClick={() => void runSports()} disabled={busy}>
          {busy ? "Running…" : "Run 25 sports cards"}
        </button>
      </div>

      <div className="table-wrap" style={{ marginBottom: 20 }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Expected</th>
              <th>Software ID</th>
              <th>Bucket</th>
              <th>LIVE</th>
              <th>Disposition</th>
              <th>Listing</th>
              <th>Flags</th>
              <th>Human s</th>
            </tr>
          </thead>
          <tbody>
            {(run?.items ?? []).map((item) => (
              <tr
                key={item.slot}
                onClick={() => setSlot(item.slot)}
                style={{
                  cursor: "pointer",
                  outline: item.slot === slot ? "1px solid #c9a227" : undefined,
                }}
              >
                <td>{item.slot}</td>
                <td>
                  <strong>{item.roster.expected.displayName}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    ${item.roster.intendedAskBandUsd.low}–$
                    {item.roster.intendedAskBandUsd.high} intent ·{" "}
                    {item.roster.messFlags.join(", ")}
                  </div>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {item.result?.identity.displayName ?? "—"}
                </td>
                <td>{item.result?.inventoryBucket ?? "—"}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {item.result?.liveRange?.label ?? "not fetched"}
                </td>
                <td>{item.result?.disposition?.action ?? "—"}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {item.result?.listing?.status ?? "—"}
                  {item.result?.listing?.submitReady ? "" : " · submitReady false"}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {(item.inspection?.failureClasses ?? item.result?.softwareFlags ?? []).join(
                    ", ",
                  ) || "—"}
                </td>
                <td>{item.inspection?.humanSeconds ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {current ? (
        <form className="panel" onSubmit={(e) => void saveInspect(e)}>
          <h2 style={{ marginTop: 0 }}>Inspect slot {current.slot}</h2>
          <p className="muted">
            Expected: {current.roster.expected.displayName}. Software:{" "}
            {current.result?.identity.displayName ?? "none"}.{" "}
            {current.result?.softwareFlagNotes.join(" ") || "No software flags."}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {FAILURES.map((f) => (
              <label key={f} className="muted" style={{ fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={classes.includes(f)}
                  onChange={() =>
                    setClasses((cur) =>
                      cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f],
                    )
                  }
                />{" "}
                {f}
              </label>
            ))}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Money-affecting disagreement only"
            rows={3}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setTiming(timing == null ? Date.now() - seconds * 1000 : null)}
            >
              {timing == null ? "Start timer" : "Stop timer"}
            </button>
            <label>
              Human seconds{" "}
              <input
                type="number"
                min={0}
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
                style={{ width: 80 }}
              />
            </label>
            <button type="submit" disabled={busy}>
              Save inspection
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
