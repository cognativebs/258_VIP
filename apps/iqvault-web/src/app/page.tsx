import { Nav } from "@/components/Nav";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import {
  apiGet,
  BINDER_URL,
  type Holding,
  type InventoryResponse,
  type TcgBindersResponse,
} from "@/lib/api";

function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default async function PortfolioPage() {
  let data: InventoryResponse | null = null;
  let tcg: TcgBindersResponse | null = null;
  let error: string | null = null;
  try {
    data = await apiGet<InventoryResponse>("/api/inventory");
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load inventory";
  }
  try {
    tcg = await apiGet("/api/tcg/binders");
  } catch {
    tcg = null;
  }

  const isTcgHolding = (h: Holding) =>
    h.id.startsWith("binder-slot-") ||
    !!h.pillar?.startsWith("TCG ") ||
    (h.externalIds?.some((e) => e.source === "pokemontcg") ?? false);
  const comicsHoldings = data?.holdings.filter((h) => !isTcgHolding(h)) ?? [];
  const tcgHoldings = data?.holdings.filter(isTcgHolding) ?? [];
  // Binder-owned pockets, or Pokémon seed rows when Binder has none marked owned yet.
  const binderOwned = tcgHoldings.filter((h) => h.pillar === "TCG Owned (Binder)");
  const seedTcg = tcgHoldings.filter(
    (h) => !h.id.startsWith("binder-slot-") && !h.pillar?.startsWith("TCG "),
  );
  const tcgOwned = binderOwned.length ? binderOwned : seedTcg;
  const tcgNeed = tcgHoldings.filter((h) => h.pillar === "TCG Need (Binder)");

  return (
    <div className="shell">
      <><Nav active="/" />
      <h1 className="page-title">Portfolio</h1>
      <p className="page-sub">
        Live comics and Binder TCG from the same Postgres. Derived fields carry provenance.
        Snapshot totals are labeled CLZ / market point prices — not verified ranges.
      </p>

      {error ? (
        <div className="error">
          {error}. Start the API with <code>npm run api</code> (port 8787).
        </div>
      ) : null}

      {data && !data.comicsAvailable ? (
        <div className="error">
          Comics Postgres unavailable
          {data.comicsError ? `: ${data.comicsError}` : "."} Portfolio is missing the real
          collection — not falling back to a sample. Run{" "}
          <code>python scripts/import_clz.py --xml &lt;export.xml&gt;</code> and ensure Postgres
          is up.
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid-stats">
            <div className="stat">
              <div className="n">{data.comicsCount}</div>
              <div className="l">
                Comics
                {data.comicsAvailable ? " · live" : " · unavailable"}
              </div>
            </div>
            <div className="stat">
              <div className="n">${data.totalValueEstimate.amount.toLocaleString()}</div>
              <div className="l">Snapshot sum · {data.totalValueEstimate.confidence} conf</div>
            </div>
            <div className="stat">
              <div className="n">
                {data.holdings.filter((h) => h.needsVerification).length}
              </div>
              <div className="l">Needs verification</div>
            </div>
          </div>
          <p className="muted" style={{ marginTop: -8, marginBottom: 16, fontSize: 13 }}>
            {data.totalValueEstimate.note}
            {data.comicsSnapshot
              ? ` · ${data.comicsSnapshot.label} · sha ${data.comicsSnapshot.shortHash} · age ${data.comicsSnapshot.ageDays}d`
              : ""}
            {data.tcgSource ? ` · TCG source: ${data.tcgSource}` : ""}
          </p>

          <section className="tcg-panel">
            <div className="tcg-panel-head">
              <div>
                <h2 className="section-title">Pokémon / Binder Vault</h2>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Layout stays in Binder (new tab). Owned flags and pocket prices feed this
                  portfolio via VIP. Full grid:{" "}
                  <a href="/collections/pokemon">/collections/pokemon</a>.
                </p>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <a className="btn-link" href="/collections/pokemon">
                  Pokémon terminal
                </a>
                <a
                  className="btn-link"
                  href={BINDER_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Binder ↗
                </a>
              </div>
            </div>

            {tcg && !tcg.available ? (
              <div className="error" style={{ marginTop: 12 }}>
                Binder Postgres (`vault_tcg`) not available
                {tcg.error ? `: ${tcg.error}` : "."} Apply migrations (
                <code>python scripts/migrate_db.py</code>) and run{" "}
                <code>npm run binder</code>.
              </div>
            ) : null}

            {tcg?.available ? (
              <>
                <div className="grid-stats tcg-stats">
                  <div className="stat">
                    <div className="n">{tcg.binders.length}</div>
                    <div className="l">Binders</div>
                  </div>
                  <div className="stat">
                    <div className="n">{tcg.ownedSlots}</div>
                    <div className="l">Owned pockets</div>
                  </div>
                  <div className="stat">
                    <div className="n">{tcg.needSlots}</div>
                    <div className="l">Still needed</div>
                  </div>
                </div>

                <div className="table-wrap" style={{ marginBottom: 20 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Binder</th>
                        <th>Pages</th>
                        <th>Filled</th>
                        <th>Owned</th>
                        <th>Need</th>
                        <th>Owned $</th>
                        <th>Need $</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tcg.binders.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <strong>{b.name}</strong>
                          </td>
                          <td>{b.pages}</td>
                          <td>{b.filledSlots}</td>
                          <td>{b.ownedSlots}</td>
                          <td>{b.needSlots}</td>
                          <td>{usd(b.ownedMarketSum)}</td>
                          <td>{usd(b.needMarketSum)}</td>
                          <td>
                            <a
                              className="btn-link"
                              href={`${BINDER_URL}/?binderId=${encodeURIComponent(b.id)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {tcgOwned.length > 0 ? (
              <>
                <h3 className="section-title" style={{ fontSize: 18 }}>
                  Owned cards (sample)
                </h3>
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
                      {tcgOwned.slice(0, 24).map((h) => (
                        <tr key={h.id}>
                          <td>
                            <strong>{h.assetName}</strong>
                          </td>
                          <td>
                            {h.currentPrice != null ? usd(h.currentPrice) : "—"}
                          </td>
                          <td className="muted" style={{ fontSize: 12 }}>
                            {h.verificationNotes ?? "—"}
                          </td>
                          <td>
                            <ProvenanceBadge provenance={h.provenance} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {tcgNeed.length > 0 ? (
              <p className="muted" style={{ fontSize: 13, marginBottom: 24 }}>
                {tcgNeed.length} still-needed Binder pockets are in VIP inventory (not listed
                above). Open Binder with <strong>Highlight Missing</strong> to hunt them.
              </p>
            ) : null}
          </section>

          <h2 className="section-title">Comics / sample holdings</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Pillar</th>
                  <th>Scores</th>
                  <th>Label</th>
                  <th>Provenance</th>
                </tr>
              </thead>
              <tbody>
                {(comicsHoldings.length ? comicsHoldings : data.holdings)
                  .filter((h) => !h.pillar?.startsWith("TCG "))
                  .slice(0, 40)
                  .map((h) => (
                    <tr key={h.id}>
                      <td>
                        <strong>{h.assetName}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {h.publisher}
                          {h.assumedGrade ? ` · ${h.assumedGrade}` : ""}
                          {h.gradeRating == null && h.assumedGrade === "NM"
                            ? " (grade null)"
                            : ""}
                        </div>
                      </td>
                      <td>{h.pillar ?? "—"}</td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        MUS {h.museumScore ?? "—"} · INV {h.investmentScore ?? "—"} · LIQ{" "}
                        {h.liquidityScore ?? "—"}
                      </td>
                      <td>{h.recommendationLabel ?? "—"}</td>
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
        </>
      ) : null}
      </>
    </div>
  );
}
