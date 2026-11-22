"use client";

import { useMemo, useState } from "react";
import { VerificationChip } from "../components/VerificationChip";
import { ValueRange } from "../components/ValueRange";
import type { VaultModel } from "../live/load";
import type { VaultCategory } from "../live/holding";

const PAGE = 48;
const VIEWS = [
  { id: "all", label: "All holdings" },
  { id: "review", label: "Needs review" },
  { id: "unpriced", label: "Unpriced" },
  { id: "high", label: "High confidence" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

export function VaultView({ model }: { model: VaultModel }) {
  const [view, setView] = useState<ViewId>("all");
  const [category, setCategory] = useState<VaultCategory | "All">("All");
  const [shown, setShown] = useState(PAGE);
  const categories = useMemo(() => {
    const present = new Set(model.assets.map((asset) => asset.category));
    return ["All", ...present] as ("All" | VaultCategory)[];
  }, [model.assets]);
  const filtered = model.assets.filter((asset) => {
    if (category !== "All" && asset.category !== category) return false;
    if (view === "review") return asset.needsReview;
    if (view === "unpriced") return asset.range.confidence === "none";
    if (view === "high") return asset.range.confidence === "high";
    return true;
  });
  const visible = filtered.slice(0, shown);
  const reviewCount = model.assets.filter((asset) => asset.needsReview).length;

  return (
    <div className="vip-screen vip-screen-vault">
      <aside className="vip-rail vip-rail-left" aria-label="Saved views">
        <p className="vip-kicker">Saved views</p>
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={view === item.id ? "vip-rail-btn is-active" : "vip-rail-btn"}
            onClick={() => {
              setView(item.id);
              setShown(PAGE);
            }}
          >
            {item.label}
          </button>
        ))}
        <p className="vip-rail-foot">
          <span className="vip-num">{reviewCount}</span> need review. That state stays open.
        </p>
      </aside>
      <div className="vip-screen-body">
        <header className="vip-screen-head">
          <div>
            <p className="vip-kicker">Vault</p>
            <h1>Holdings</h1>
            {model.sourceNote ? <p className="vip-muted">{model.sourceNote}</p> : null}
          </div>
          <div className="vip-pills" aria-label="Categories">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                className={category === item ? "vip-pill is-active" : "vip-pill"}
                onClick={() => {
                  setCategory(item);
                  setShown(PAGE);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        </header>
        {model.error ? <p className="vip-callout">{model.error}</p> : null}
        {model.notice ? <p className="vip-callout">{model.notice}</p> : null}
        <section className="vip-coverage" aria-label="Coverage">
          <div>
            <p className="vip-kicker">By asset</p>
            <p className="vip-coverage-figure">
              <span className="vip-num">{model.coverage.byAssetPercent == null ? "—" : `${model.coverage.byAssetPercent}%`}</span>
              <span className="vip-muted">
                <span className="vip-num">{model.coverage.byAssetCovered.toLocaleString("en-US")}</span>
                {" / "}
                <span className="vip-num">{model.coverage.byAssetTotal.toLocaleString("en-US")}</span>
                {" with a listing range"}
              </span>
            </p>
          </div>
          <p className="vip-coverage-note">{model.coverage.byValueNote} Ranges on a card are eBay Browse asks, unverified, not sold comps.</p>
        </section>
        <div className="vip-asset-grid">
          {visible.map((asset) => (
            <article key={asset.id} className="vip-card" data-asset={asset.id}>
              <header>
                <h2>{asset.name}</h2>
                {asset.detail ? <p className="vip-muted">{asset.detail}</p> : null}
              </header>
              <div className="vip-card-flags">
                {asset.verification.verified || !asset.verification.label ? null : (
                  <VerificationChip label={asset.verification.label} />
                )}
                {asset.needsReview ? <span className="vip-chip vip-chip-review">Needs review</span> : null}
              </div>
              <ValueRange {...asset.range} />
            </article>
          ))}
          {filtered.length === 0 ? <p className="vip-muted">No holdings in this view.</p> : null}
        </div>
        {shown < filtered.length ? (
          <button type="button" className="vip-button" onClick={() => setShown((count) => count + PAGE)}>
            Show more · <span className="vip-num">{filtered.length - shown}</span> remaining
          </button>
        ) : null}
      </div>
    </div>
  );
}
