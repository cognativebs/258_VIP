"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiGet } from "@/lib/api";

type Dashboard = {
  connection: {
    canPublish: boolean;
    blockers: string[];
    accessTokenChars?: number;
    status: {
      connected: boolean;
      configured: boolean;
      environment: string;
      mode: string;
      lastError: string | null;
      policiesConfigured: boolean;
    };
  };
  cards: {
    activeListings: number;
    salesToday: number;
    sales7d: number;
    sales30d: number;
    gross: number;
    net: number | null;
    netIsEstimate: boolean;
    ordersNeedingShipment: number;
    listingErrors: number;
    staleListings: number;
  };
  kpis: {
    sales: { grossSales: number; netProceeds: number | null; salesCount: number };
    funnel: { impressions: number | null; views: number | null };
  };
};

type PreflightCheck = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "skip";
  detail: string;
  fix: string | null;
};

type PreflightReport = {
  environment: string;
  marketplaceId: string;
  ok: boolean;
  failures: number;
  warnings: number;
  skipped: number;
  checks: PreflightCheck[];
};

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function EbayDashboardInner() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const oauthError = params.get("oauth_error");
  const justConnected = params.get("connected") === "1";

  useEffect(() => {
    void apiGet<Dashboard>("/api/ebay/sell/dashboard")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load eBay dashboard"));
  }, [justConnected]);

  const connected = data?.connection.status.connected ?? false;

  return (
    <div className="shell">
      <Nav active="/ebay" />
      <h1 className="page-title">eBay selling loop</h1>
      <p className="page-sub">
        Closed loop: recommend → human approve → official Inventory API → orders → internal sale
        observation. Browse comps stay unverified asks. Fees are labeled estimates. Connection is
        never faked.
      </p>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/ebay/queue">Listing queue</Link>
        {" · "}
        <Link href="/ebay/lots">Lot builder</Link>
        {" · "}
        <Link href="/ebay/experiments">Experiments</Link>
        {" · "}
        <Link href="/listings">Legacy drafts</Link>
      </p>
      {justConnected ? <div className="panel">Sandbox seller connected.</div> : null}
      {oauthError ? <div className="error">{oauthError}</div> : null}
      {error ? <div className="error">{error}</div> : null}
      <div className="stack" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", display: "grid" }}>
        <div className="stat">
          <div className="n">{connected ? "Connected" : "Idle"}</div>
          <div className="l">
            {data?.connection.status.environment ?? "sandbox"} · {data?.connection.status.mode ?? "…"}
          </div>
        </div>
        <div className="stat">
          <div className="n">{data?.cards.activeListings ?? "—"}</div>
          <div className="l">Active listings</div>
        </div>
        <div className="stat">
          <div className="n">
            {data?.cards.salesToday ?? "—"} / {data?.cards.sales7d ?? "—"} / {data?.cards.sales30d ?? "—"}
          </div>
          <div className="l">Sales today / 7d / 30d</div>
        </div>
        <div className="stat">
          <div className="n">
            {money(data?.cards.gross)} / {money(data?.cards.net)}
          </div>
          <div className="l">Gross / net{data?.cards.netIsEstimate ? " · estimate" : ""}</div>
        </div>
        <div className="stat">
          <div className="n">{data?.cards.ordersNeedingShipment ?? "—"}</div>
          <div className="l">Orders needing shipment</div>
        </div>
        <div className="stat">
          <div className="n">{data?.cards.listingErrors ?? "—"}</div>
          <div className="l">Listing errors</div>
        </div>
        <div className="stat">
          <div className="n">{data?.cards.staleListings ?? "—"}</div>
          <div className="l">Stale listings</div>
        </div>
        <div className="stat">
          <div className="n">
            {data?.kpis.funnel.impressions ?? "—"} / {data?.kpis.funnel.views ?? "—"}
          </div>
          <div className="l">Impressions / views</div>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Connection</h3>
        {data?.connection.canPublish ? (
          <p className="muted">
            Sell APIs are authorized and business policies are configured.
            {typeof data.connection.accessTokenChars === "number"
              ? data.connection.accessTokenChars > 0
                ? ` User access token ready (${data.connection.accessTokenChars} chars).`
                : " User access token is empty — refresh failed; check the API terminal."
              : ""}
          </p>
        ) : (
          <p className="muted">
            Not ready to publish.
            {data?.connection.blockers?.length
              ? ` Blockers: ${data.connection.blockers.join(", ")}.`
              : ""}{" "}
            {data?.connection.status.lastError ??
              "Set EBAY_APP_ID, EBAY_CERT_ID, EBAY_REDIRECT_URI and complete user OAuth."}
          </p>
        )}
        <p className="muted" style={{ marginBottom: 0 }}>
          {!connected ? (
            <a href="http://127.0.0.1:8787/api/ebay/sell/auth/start">Connect Sandbox seller</a>
          ) : (
            "Sandbox seller connected."
          )}
        </p>
      </div>
      <PreflightPanel />
    </div>
  );
}

const BADGE: Record<PreflightCheck["status"], string> = {
  pass: "badge badge-ok",
  warn: "badge badge-warn",
  fail: "badge badge-danger",
  skip: "badge badge-info",
};

/**
 * Rehearses the publish chain read-only so every blocker shows up in one run
 * instead of one error per Approve / publish click.
 */
function PreflightPanel() {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setReport(await apiGet<PreflightReport>("/api/ebay/sell/preflight", 30_000));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preflight failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3>Publish preflight</h3>
      <p className="muted">
        Read-only rehearsal of scopes, seller privileges, business policies, the inventory location
        and the listing category. It creates nothing on eBay.
      </p>
      <button type="button" className="btn-primary" onClick={() => void run()} disabled={running}>
        {running ? "Running…" : "Run preflight"}
      </button>
      {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}
      {report ? (
        <>
          <p className="muted" style={{ marginTop: 12 }}>
            {report.environment} · {report.marketplaceId} ·{" "}
            {report.ok
              ? `Ready. ${report.warnings} warning(s), ${report.skipped} unverified.`
              : `Blocked by ${report.failures} check(s).`}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Result</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {report.checks.map((check) => (
                  <tr key={check.id}>
                    <td>{check.label}</td>
                    <td>
                      <span className={BADGE[check.status]}>{check.status.toUpperCase()}</span>
                    </td>
                    <td>
                      {check.detail}
                      {check.fix && check.status !== "pass" ? (
                        <div className="muted">Fix: {check.fix}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function EbayDashboardPage() {
  return (
    <Suspense fallback={<div className="shell">Loading eBay dashboard…</div>}>
      <EbayDashboardInner />
    </Suspense>
  );
}
