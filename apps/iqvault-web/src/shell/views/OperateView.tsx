"use client";

import { ValueRange } from "../components/ValueRange";
import type { OperateModel } from "../live/load";
import { useRole } from "../role-context";
import { operateHref } from "../routes";

export function OperateView({ model, sectionId }: { model: OperateModel; sectionId?: string }) {
  const { role } = useRole();
  const sections = role.secondary.OPERATE;
  const active = sections.find((section) => section.id === sectionId) ?? sections[0];

  return (
    <div className="vip-screen vip-screen-stack">
      <header className="vip-screen-head">
        <div>
          <p className="vip-kicker">Operate</p>
          <h1>{active ? active.label : "Operate"}</h1>
        </div>
      </header>
      <nav className="vip-subnav" aria-label="Operate">
        {sections.map((section) => (
          <a
            key={section.id}
            href={operateHref(section.id)}
            data-section={section.id}
            className={active?.id === section.id ? "vip-subnav-link is-active" : "vip-subnav-link"}
            aria-current={active?.id === section.id ? "page" : undefined}
          >
            {section.label}
          </a>
        ))}
      </nav>
      {active ? <SectionBody id={active.id} label={active.label} model={model} /> : <p>This section is not in the role config.</p>}
    </div>
  );
}

function SectionBody({ id, label, model }: { id: string; label: string; model: OperateModel }) {
  if (id === "sell") return <SellList label={label} model={model} />;
  if (id === "listings") return <ListingList label={label} model={model} />;
  if (id === "transactions") return <TransactionList label={label} model={model} />;
  return (
    <section className="vip-empty" aria-label={label}>
      <p className="vip-kicker">{label}</p>
      <p>No workflow is connected in this pass.</p>
    </section>
  );
}

function SellList({ label, model }: { label: string; model: OperateModel }) {
  const sell = model.sell;
  return (
    <section className="vip-stack-list" aria-label={label}>
      {sell.error ? <p className="vip-callout">{sell.error}</p> : null}
      {sell.note ? <p className="vip-muted">{sell.note}</p> : null}
      {sell.assumption ? <p className="vip-muted">{sell.assumption}</p> : null}
      {sell.marksNote ? <p className="vip-muted">{sell.marksNote}</p> : null}
      {sell.items.length === 0 && !sell.error ? <p className="vip-muted">The sell queue is empty.</p> : null}
      {sell.items.map((item, index) => (
        <article key={item.id} className="vip-card" data-sell-item={item.id} data-action={item.action}>
          <header>
            <p className="vip-kicker">
              <span className="vip-num">{index + 1}</span> · {item.action} · confidence{" "}
              <span className="vip-num">{item.confidencePercent}%</span> ({item.confidence})
            </p>
            <h2>{item.name}</h2>
            {item.priority ? <p className="vip-muted">CLZ sell priority {item.priority} · operator label</p> : null}
          </header>
          <div className="vip-card-flags">
            {item.insufficient ? <span className="vip-chip vip-chip-caution">Insufficient market evidence</span> : null}
            {item.stale && !item.insufficient ? <span className="vip-chip vip-chip-caution">Evidence stale</span> : null}
          </div>
          {item.range ? (
            <ValueRange {...item.range} />
          ) : (
            <p className="vip-value-empty">Insufficient market evidence · no range</p>
          )}
          <ul className="vip-fact-list">
            {item.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="vip-muted">{item.provenance}</p>
        </article>
      ))}
    </section>
  );
}

function ListingList({ label, model }: { label: string; model: OperateModel }) {
  return (
    <section className="vip-stack-list" aria-label={label}>
      {model.listingsError ? <p className="vip-callout">{model.listingsError}</p> : null}
      {model.listings.length === 0 && !model.listingsError ? <p className="vip-muted">No listing drafts.</p> : null}
      {model.listings.map((item) => (
        <article key={item.id} className="vip-card">
          <h2>{item.title}</h2>
          <p className="vip-muted">{item.status}</p>
          {item.ask != null ? (
            <p>
              Draft ask <span className="vip-num">${item.ask.toLocaleString("en-US")}</span>
            </p>
          ) : null}
          <ValueRange {...item.range} />
        </article>
      ))}
    </section>
  );
}

function TransactionList({ label, model }: { label: string; model: OperateModel }) {
  return (
    <section className="vip-stack-list" aria-label={label}>
      {model.transactionsError ? <p className="vip-callout">{model.transactionsError}</p> : null}
      {model.transactions.length === 0 && !model.transactionsError ? <p className="vip-muted">No transactions recorded.</p> : null}
      {model.transactions.map((item) => (
        <article key={item.id} className="vip-card">
          <h2>{item.kind}</h2>
          <p className="vip-muted">{item.occurredAt}</p>
          <p>
            Recorded amount{" "}
            {item.amount == null ? (
              "none"
            ) : (
              <span className="vip-num">
                {item.amount.toLocaleString("en-US")} {item.currency}
              </span>
            )}
          </p>
        </article>
      ))}
    </section>
  );
}
