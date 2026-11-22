"use client";

import { useState } from "react";
import { EvidenceRail } from "../components/EvidenceRail";
import { InsufficientEvidence } from "../components/InsufficientEvidence";
import { ValueRange } from "../components/ValueRange";
import type { AdvisorModel } from "../live/load";

export function AdvisorView({ model }: { model: AdvisorModel }) {
  const [saved, setSaved] = useState(false);
  const ranged = model.answers.find((answer) => answer.kind === "range");

  return (
    <div className="vip-screen vip-screen-advisor">
      <aside className="vip-rail vip-rail-left" aria-label="Track record">
        <p className="vip-kicker">Track record</p>
        <dl className="vip-stats">
          <div>
            <dt>Returned</dt>
            <dd className="vip-num">{model.returned}</dd>
          </div>
        </dl>
        <p className="vip-muted">No prediction log is connected.</p>
      </aside>
      <div className="vip-thread">
        <header className="vip-screen-head">
          <div>
            <p className="vip-kicker">Advisor</p>
            <h1>Recommendations</h1>
          </div>
        </header>
        {model.error ? <p className="vip-callout">{model.error}</p> : null}
        {model.notice ? <p className="vip-callout">{model.notice}</p> : null}
        {model.answers.map((answer) =>
          answer.kind === "range" ? (
            <article key={answer.id} className="vip-message vip-message-answer">
              <p className="vip-kicker">{answer.name}</p>
              <p>{answer.action}</p>
              <ValueRange {...answer.range} />
            </article>
          ) : (
            <div key={answer.id}>
              <p className="vip-kicker">{answer.name}</p>
              <InsufficientEvidence {...answer.insufficient} />
            </div>
          ),
        )}
        {model.answers.length === 0 ? (
          <InsufficientEvidence
            reason="No recommendation was returned."
            facts={["The decision engine sent an empty list."]}
            actions={[{ label: "Open the vault", href: "/vault" }]}
          />
        ) : null}
      </div>
      <EvidenceRail
        confidence={ranged ? ranged.range.confidence : "None"}
        limiter={ranged ? ranged.limiter : "No ranged recommendation is on this response."}
        sources={ranged?.sources.length ? ranged.sources : ["No supporting evidence on this response."]}
        counterEvidence={ranged?.counterEvidence.length ? ranged.counterEvidence : ["No counter-evidence on this response."]}
        whatWouldChange={["The recommendation record does not include a change list."]}
        saved={saved}
        onSave={() => setSaved(true)}
      />
    </div>
  );
}
