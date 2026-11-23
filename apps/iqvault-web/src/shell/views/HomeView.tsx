import { conceptHref } from "../routes";
import type { IngestModel, SignalsModel, VaultModel } from "../live/load";

export function HomeView({
  vault,
  signals,
  ingest,
}: {
  vault: VaultModel;
  signals: SignalsModel;
  ingest: IngestModel;
}) {
  const review = vault.assets.filter((asset) => asset.needsReview).length;
  const unpriced = vault.assets.filter((asset) => asset.range.confidence === "none").length;
  const loud = signals.items[0];

  return (
    <div className="vip-screen vip-screen-stack">
      <header className="vip-screen-head">
        <div>
          <p className="vip-kicker">Home</p>
          <h1>Where you left off</h1>
        </div>
      </header>
      <div className="vip-home-grid">
        <section className="vip-card" aria-label="Continue">
          <p className="vip-kicker">Continue</p>
          <ul className="vip-link-list">
            <li>
              <a href={conceptHref("VAULT")}>
                Vault · <span className="vip-num">{vault.assets.length}</span> holdings
              </a>
            </li>
            <li>
              <a href={conceptHref("INGEST")}>
                Ingest · {ingest.batchName ?? "no open batch"} · {ingest.stage}
              </a>
            </li>
            <li>
              <a href={conceptHref("ADVISOR")}>Advisor · recommendations from the decision engine</a>
            </li>
          </ul>
        </section>
        <section className="vip-card" aria-label="Attention">
          <p className="vip-kicker">Attention</p>
          <ul className="vip-link-list">
            <li>
              <a href={conceptHref("VAULT")}>
                <span className="vip-num">{review}</span> holdings need review
              </a>
            </li>
            <li>
              <a href={conceptHref("VAULT")}>
                <span className="vip-num">{unpriced}</span> holdings have no listing range
              </a>
            </li>
            {loud ? (
              <li>
                <a href={conceptHref("SIGNALS")}>{loud.title}</a>
              </li>
            ) : (
              <li>No signal on the feed.</li>
            )}
          </ul>
        </section>
        <section className="vip-card" aria-label="Intelligence">
          <p className="vip-kicker">Intelligence</p>
          <p>
            {vault.error
              ? vault.error
              : "A holding without a listing range stays unpriced. A signal does not fill that gap."}
          </p>
          <a className="vip-text-action" href={conceptHref("ADVISOR")}>
            Open recommendations
          </a>
        </section>
      </div>
    </div>
  );
}
