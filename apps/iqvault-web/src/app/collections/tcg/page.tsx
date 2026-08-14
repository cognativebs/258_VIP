import { Nav } from "@/components/Nav";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { TcgSourceBar } from "@/components/tcg/TcgTerminal";
import {
  apiGet,
  BINDER_URL,
  type InventoryResponse,
  type TcgBindersResponse,
} from "@/lib/api";
import { splitTcgHoldings } from "@/lib/collections";

export const dynamic = "force-dynamic";

function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default async function TcgCollectionPage() {
  let data: InventoryResponse | null = null;
  let binders: TcgBindersResponse | null = null;
  let error: string | null = null;

  try {
    data = await apiGet<InventoryResponse>("/api/inventory");
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load inventory";
  }
  try {
    binders = await apiGet<TcgBindersResponse>("/api/tcg/binders");
  } catch {
    binders = null;
  }

  const split = splitTcgHoldings(data?.holdings ?? []);
  const ownedRows = split.owned.length ? split.owned : split.seeds;
  const usingSeeds = split.owned.length === 0 && split.seeds.length > 0;

  return (
    <div className="shell">
      <Nav active="/collections/tcg" />
      <TcgSourceBar />
      <h1 className="page-title">TCG / Binder</h1>
      <p className="page-sub">
        Pokemon binder pockets from the same Postgres as comics. Layout and pricing stay in
        Binder; VIP holds the owned/need decisions.
      </p>

      {error ? (
        <div className="error">
          {error}. Start the API with <code>npm run api</code> (port 8787).
        </div>
      ) : null}

      {binders && !binders.available ? (
        <div className="error">
          Binder Postgres (<code>vault_tcg</code>) unavailable
          {binders.error ? `: ${binders.error}` : "."} Run{" "}
          <code>python scripts/migrate_db.py</code> then <code>npm run binder</code>.
        </div>
      ) : null}

      {usingSeeds ? (
        <div className="panel" style={{ marginBottom: 16 }}>
          <strong>No owned Binder pockets yet.</strong>{" "}
          <span className="muted">
            Showing Pokemon seed rows so the page is not blank — these are seeds, not your
            binder. Mark pockets owned in Binder and push to VIP.
          </span>
        </div>
      ) : null}

      <div className="grid-stats">
        <div className="stat">
          <div className="n">{ownedRows.length.toLocaleString()}</div>
          <div className="l">{usingSeeds ? "Seed cards" : "Owned pockets"}</div>
        </div>
        <div className="stat">
          <div className="n">{split.need.length.toLocaleString()}</div>
          <div className="l">Still needed</div>
        </div>
        <div className="stat">
          <div className="n">{usd(split.ownedValue)}</div>
          <div className="l">Owned market sum · low conf</div>
        </div>
      </div>
      <p className="muted" style={{ marginTop: -8, marginBottom: 16, fontSize: 13 }}>
        Market sums are Binder point prices, not verified ranges.
        {data?.tcgSource ? ` · source: ${data.tcgSource}` : ""}
      </p>

      {binders?.available && binders.binders.length > 0 ? (
        <>
          <h2 className="section-title">Binders</h2>
          <div className="table-wrap" style={{ marginBottom: 24 }}>
            <table>
              <thead>
                <tr>
                  <th>Binder</th>
                  <th>Pages</th>
                  <th>Filled</th>
                  <th>Owned</th>
                  <th>Need</th>
                  <th>Owned $</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {binders.binders.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.name}</strong>
                    </td>
                    <td>{b.pages}</td>
                    <td>{b.filledSlots}</td>
                    <td>{b.ownedSlots}</td>
                    <td>{b.needSlots}</td>
                    <td>{usd(b.ownedMarketSum)}</td>
                    <td>
                      <a
                        className="btn-link"
                        href={`${BINDER_URL}/?binderId=${encodeURIComponent(b.id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2 className="section-title">{usingSeeds ? "Seed cards" : "Owned cards"}</h2>
      {ownedRows.length === 0 ? (
        <p className="muted">
          Nothing owned yet. Mark pockets owned in Binder, then use{" "}
          <strong>Push to VIP</strong>.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginBottom: 24 }}>
          <table>
            <thead>
              <tr>
                <th>Card</th>
                <th>Price</th>
                <th>Notes</th>
                <th>Provenance</th>
              </tr>
            </thead>
            <tbody>
              {ownedRows.slice(0, 100).map((h) => (
                <tr key={h.id}>
                  <td>
                    <strong>{h.assetName}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {h.publisher}
                    </div>
                  </td>
                  <td>{h.currentPrice != null ? usd(h.currentPrice) : "—"}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {h.verificationNotes ?? "—"}
                  </td>
                  <td>
                    <ProvenanceBadge provenance={h.provenance} />
                    {h.needsVerification ? (
                      <span className="badge badge-warn">needs verification</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {split.need.length > 0 ? (
        <>
          <h2 className="section-title">Still needed ({split.need.length})</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Card</th>
                  <th>Market</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {split.need.slice(0, 60).map((h) => (
                  <tr key={h.id}>
                    <td>{h.assetName}</td>
                    <td>{h.currentPrice != null ? usd(h.currentPrice) : "—"}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {h.verificationNotes ?? "—"}
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
