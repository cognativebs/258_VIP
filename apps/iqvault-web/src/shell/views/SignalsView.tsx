"use client";

import { useState } from "react";
import { OriginChain } from "../components/OriginChain";
import { ValueRange } from "../components/ValueRange";
import type { SignalItemModel, SignalsModel } from "../live/load";

export function SignalsView({ model }: { model: SignalsModel }) {
  const categories = ["All", ...new Set(model.items.map((item) => item.category))];
  const [category, setCategory] = useState("All");
  const visible = category === "All" ? model.items : model.items.filter((item) => item.category === category);
  const [selectedId, setSelectedId] = useState(model.items[0]?.id ?? "");
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0];

  return (
    <div className="vip-screen vip-screen-signals">
      <aside className="vip-rail vip-rail-left" aria-label="Signal categories">
        <p className="vip-kicker">Categories</p>
        {categories.map((item) => {
          const count = item === "All" ? model.items.length : model.items.filter((signal) => signal.category === item).length;
          return (
            <button
              key={item}
              type="button"
              className={category === item ? "vip-rail-btn is-active" : "vip-rail-btn"}
              onClick={() => setCategory(item)}
            >
              <span>{item}</span>
              <span className="vip-num">{count}</span>
            </button>
          );
        })}
      </aside>
      <div className="vip-feed" aria-label="Signal feed">
        <header className="vip-screen-head">
          <div>
            <p className="vip-kicker">Signals</p>
            <h1>Reader</h1>
            {model.source ? <p className="vip-muted">{model.source}</p> : null}
          </div>
        </header>
        {model.error ? <p className="vip-callout">{model.error}</p> : null}
        {model.notice ? <p className="vip-callout">{model.notice}</p> : null}
        {visible.length === 0 ? <p className="vip-muted">No signals on this feed.</p> : null}
        {visible.map((signal) => (
          <SignalCard key={signal.id} signal={signal} selected={signal.id === selected?.id} onSelect={() => setSelectedId(signal.id)} />
        ))}
      </div>
      {selected ? <SignalContext signal={selected} /> : null}
    </div>
  );
}

function SignalCard({
  signal,
  selected,
  onSelect,
}: {
  signal: SignalItemModel;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <article
      className={selected ? "vip-signal-card is-selected" : "vip-signal-card"}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <p className="vip-kicker">{signal.category}</p>
      <h2>{signal.title}</h2>
      <p className="vip-signal-body">{signal.body}</p>
      <p className="vip-muted">
        <span className="vip-num">{signal.date}</span>
        {" · "}
        {signal.quarantine}
      </p>
      {signal.linkage.status === "resolved" ? (
        <p className="vip-why">
          <span className="vip-kicker">Why VIP cares</span>
          {signal.linkage.whyVipCares}
        </p>
      ) : (
        <div>
          <p className="vip-linkage-note">{signal.linkage.note}</p>
          <OriginChain
            sources={[{ id: signal.id, title: signal.linkage.originTitle, kind: "primary" }]}
            corroboration="One source on this feed. Derivatives are not counted."
          />
        </div>
      )}
    </article>
  );
}

function SignalContext({ signal }: { signal: SignalItemModel }) {
  return (
    <aside className="vip-rail vip-rail-right" aria-label="Signal context">
      <p className="vip-kicker">Context</p>
      <h2>{signal.title}</h2>
      <p className="vip-muted">Fact confidence and attention are not on this feed.</p>
      {signal.linkage.status === "resolved" ? (
        <section className="vip-holding-value">
          <p className="vip-kicker">Holding · {signal.linkage.holdingName}</p>
          <ValueRange {...signal.linkage.range} />
        </section>
      ) : (
        <section>
          <p className="vip-linkage-note">{signal.linkage.note}</p>
          <OriginChain
            sources={[{ id: signal.id, title: signal.linkage.originTitle, kind: "primary" }]}
            corroboration="One source on this feed. Derivatives are not counted."
          />
        </section>
      )}
    </aside>
  );
}
