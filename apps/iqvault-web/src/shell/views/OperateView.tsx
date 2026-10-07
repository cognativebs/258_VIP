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
  return (
    <section className="vip-stack-list" aria-label={label}>
      {model.sellError ? <p className="vip-callout">{model.sellError}</p> : null}
      {model.sell.length === 0 && !model.sellError ? <p className="vip-muted">The sell queue is empty.</p> : null}
      {model.sell.map((item) => (
        <article key={item.id} className="vip-card">
          <h2>{item.name}</h2>
          {item.priority ? <p className="vip-muted">Priority {item.priority}</p> : null}
          <ValueRange {...item.range} />
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
