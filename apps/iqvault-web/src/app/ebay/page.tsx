"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiGet } from "@/lib/api";

type Dashboard = {
  connection: {
    canPublish: boolean;
    blockers: string[];
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

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function EbayDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<Dashboard>("/api/ebay/sell/dashboard")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load eBay dashboard"));
  }, []);

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
          <p className="muted">Sell APIs are authorized and business policies are configured.</p>
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
          Auth start: <code>/api/ebay/sell/auth/start</code> (VIP :8787). Sandbox first.
        </p>
      </div>
    </div>
  );
}
