"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { apiGet, apiPost, type Holding, type Provenance } from "@/lib/api";

type Tab =
  | "identity"
  | "valuation"
  | "disposition"
  | "listings"
  | "traffic"
  | "orders"
  | "observations"
  | "decisions";

type Detail = {
  holding: Holding;
  asset: {
    sku?: string;
    year?: number | null;
    setName?: string | null;
    playerSubject?: string | null;
    cardNumber?: string | null;
    frontImageUri?: string | null;
    backImageUri?: string | null;
    fmv: {
      low: number;
      high: number;
      mid: number;
      confidence: number;
      evidenceCount: number;
      notes?: string;
    } | null;
  };
  disposition: {
    disposition: string;
    confidence: number;
    reasonCodes: string[];
    reasonText: string;
    provenance: Provenance;
  };
  listings: {
    id: string;
    status: string;
    sku: string;
    title: string;
    price: number | null;
    externalOfferId: string | null;
    externalListingId: string | null;
    fmvAtListing: { mid: number } | null;
    errorMessage?: string | null;
  }[];
  traffic: { impressionsTotal: number | null; viewsTotal: number | null; capturedAt: string }[];
  orderLines: { sku: string; salePrice: number; externalOrderId?: string }[];
  observations: {
    observationType: string;
    value: number;
    source: string;
    observedAt: string;
    provenance: Provenance;
  }[];
  decisionHistory: {
    previousDisposition: string | null;
    newDisposition: string;
    recommendedBy: string;
    reasonText: string;
    createdAt: string;
  }[];
};

const TABS: { id: Tab; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "valuation", label: "Valuation" },
  { id: "disposition", label: "Disposition" },
  { id: "listings", label: "eBay listing history" },
  { id: "traffic", label: "Traffic" },
  { id: "orders", label: "Orders" },
  { id: "observations", label: "Market observations" },
  { id: "decisions", label: "Decision history" },
];

export default function EbayItemPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const [tab, setTab] = useState<Tab>("identity");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const data = await apiGet<Detail>(`/api/ebay/sell/item/${id}`);
    setDetail(data);
  }

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Item failed"));
  }, [id]);

  async function draft() {
    setBusy(true);
    try {
      await apiPost(`/api/ebay/sell/item/${id}/draft`, {});
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setBusy(false);
    }
  }

  async function publish(listingId: string) {
    setBusy(true);
    try {
      await apiPost(`/api/ebay/sell/listings/${listingId}/publish`, { inventoryId: id });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }

  async function override(disposition: string) {
    setBusy(true);
    try {
      await apiPost(`/api/ebay/sell/item/${id}/disposition`, {
        disposition,
        reasonText: `Operator set ${disposition} from item detail`,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Override failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <Nav active="/ebay" />
      <h1 className="page-title">{detail?.holding.assetName ?? "Item"}</h1>
      <p className="page-sub">
        <Link href="/ebay">eBay dashboard</Link> · SKU{" "}
        {detail?.asset.sku ?? detail?.listings[0]?.sku ?? "unminted"} · FMV is a
        range + evidence, not a point fact.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "nav-link on" : "nav-link"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "identity" ? (
        <div className="panel">
          <p>
            {detail?.asset.year} {detail?.asset.setName} {detail?.asset.playerSubject} #
            {detail?.asset.cardNumber}
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            {detail?.asset.frontImageUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={detail.asset.frontImageUri} alt="Front" width={160} />
            ) : (
              <span className="muted">No front image</span>
            )}
            {detail?.asset.backImageUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={detail.asset.backImageUri} alt="Back" width={160} />
            ) : (
              <span className="muted">No back image</span>
            )}
          </div>
        </div>
      ) : null}

      {tab === "valuation" ? (
        <div className="panel">
          {detail?.asset.fmv ? (
            <>
              <p>
                ${detail.asset.fmv.low}–${detail.asset.fmv.high} (mid ${detail.asset.fmv.mid}) ·{" "}
                {detail.asset.fmv.evidenceCount} evidence · conf {detail.asset.fmv.confidence}
              </p>
              <p className="muted">{detail.asset.fmv.notes}</p>
            </>
          ) : (
            <p className="muted">No FMV range or snapshot.</p>
          )}
        </div>
      ) : null}

      {tab === "disposition" ? (
        <div className="panel">
          <p>
            <span className="badge badge-info">{detail?.disposition.disposition}</span>{" "}
            {detail?.disposition.reasonText}
          </p>
          <p className="muted">{detail?.disposition.reasonCodes.join(", ")}</p>
          {detail ? <ProvenanceBadge provenance={detail.disposition.provenance} /> : null}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            {["SINGLE", "LOT", "HOLD", "PC"].map((d) => (
              <button key={d} type="button" disabled={busy} onClick={() => void override(d)}>
                Override {d}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "listings" ? (
        <div className="panel">
          <button type="button" disabled={busy} onClick={() => void draft()}>
            Create / refresh draft
          </button>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Title</th>
                  <th>SKU / IDs</th>
                  <th>Price</th>
                  <th>FMV at list</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(detail?.listings ?? []).map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="badge">{l.status}</span>
                    </td>
                    <td>{l.title}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {l.sku}
                      <br />
                      offer {l.externalOfferId ?? "—"} · listing {l.externalListingId ?? "—"}
                      {l.errorMessage ? (
                        <>
                          <br />
                          {l.errorMessage}
                        </>
                      ) : null}
                    </td>
                    <td>{l.price != null ? `$${l.price}` : "—"}</td>
                    <td>{l.fmvAtListing?.mid != null ? `$${l.fmvAtListing.mid}` : "—"}</td>
                    <td>
                      <button type="button" disabled={busy} onClick={() => void publish(l.id)}>
                        Approve / publish
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "traffic" ? (
        <div className="panel">
          {(detail?.traffic ?? []).length === 0 ? (
            <p className="muted">No Traffic Report snapshots yet. Watcher/offer stay null unless the API exposes them.</p>
          ) : (
            <ul>
              {detail?.traffic.map((t, i) => (
                <li key={i}>
                  {t.capturedAt}: impressions {t.impressionsTotal ?? "—"} · views {t.viewsTotal ?? "—"}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "orders" ? (
        <div className="panel">
          {(detail?.orderLines ?? []).length === 0 ? (
            <p className="muted">No mapped eBay orders for this SKU.</p>
          ) : (
            <ul>
              {detail?.orderLines.map((o, i) => (
                <li key={i}>
                  {o.sku} · ${o.salePrice}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "observations" ? (
        <div className="panel">
          {(detail?.observations ?? []).length === 0 ? (
            <p className="muted">No holding-scoped observations. Internal sales appear here after order ingest.</p>
          ) : (
            <ul>
              {detail?.observations.map((o) => (
                <li key={o.observedAt + o.observationType}>
                  {o.observationType} · ${o.value} · {o.source} · {o.observedAt}
                  <ProvenanceBadge provenance={o.provenance} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "decisions" ? (
        <div className="panel">
          {(detail?.decisionHistory ?? []).length === 0 ? (
            <p className="muted">No disposition history yet.</p>
          ) : (
            <ul>
              {detail?.decisionHistory.map((d, i) => (
                <li key={i}>
                  {d.previousDisposition ?? "—"} → {d.newDisposition} · {d.recommendedBy} · {d.reasonText}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
