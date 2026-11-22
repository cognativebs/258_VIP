"use client";

import { useState } from "react";
import { ValueRange } from "../components/ValueRange";
import type { VerificationModel } from "../live/verification";
import { conceptHref } from "../routes";

type RowState = "open" | "saving" | "verified" | "kept" | "error";

/**
 * Needs-review burn-down. One book, one human click. "Still needs review"
 * keeps the flag set; nothing here clears it without a click, and there is no
 * "verify all".
 */
export function VerificationQueueView({
  model,
  onMark,
  nextHref = null,
}: {
  model: VerificationModel;
  /** Link to the next page of the queue, when there is one. */
  nextHref?: string | null;
  /** needsReview=false marks the book verified; true keeps it in review. Resolves true on success. */
  onMark: (id: string, needsReview: boolean) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const clearedHere = Object.values(rows).filter((state) => state === "verified").length;
  const remaining = Math.max(0, model.counts.needsVerification - clearedHere);
  const owned = model.counts.ownedTotal;
  const done = owned > 0 ? (owned - remaining) / owned : 0;

  async function mark(id: string, needsReview: boolean) {
    setRows((prev) => ({ ...prev, [id]: "saving" }));
    const ok = await onMark(id, needsReview);
    setRows((prev) => ({ ...prev, [id]: ok ? (needsReview ? "kept" : "verified") : "error" }));
  }

  return (
    <div className="vip-screen vip-screen-stack">
      <header className="vip-screen-head">
        <div>
          <p className="vip-kicker">Vault · Needs review</p>
          <h1>Verification queue</h1>
          {model.ordering ? <p className="vip-muted">Order: {model.ordering}</p> : null}
        </div>
        <a className="vip-text-action" href={conceptHref("VAULT")}>
          Back to holdings
        </a>
      </header>
      {model.error ? <p className="vip-callout">{model.error}</p> : null}
      <section className="vip-coverage" aria-label="Burn-down" data-burndown={remaining}>
        <div>
          <p className="vip-kicker">Still need verification</p>
          <p className="vip-coverage-figure">
            <span className="vip-num" data-remaining>
              {remaining.toLocaleString("en-US")}
            </span>
            <span className="vip-muted">
              {" of "}
              <span className="vip-num">{owned.toLocaleString("en-US")}</span>
              {" owned comics · "}
              <span className="vip-num" data-week>
                {(model.counts.verifiedThisWeek + clearedHere).toLocaleString("en-US")}
              </span>
              {" verified this week"}
            </span>
          </p>
          <div className="vip-spread" aria-hidden="true">
            <span className="vip-spread-fill" style={{ width: `${Math.round(done * 100)}%` }} />
          </div>
        </div>
        {model.note ? <p className="vip-coverage-note">{model.note}</p> : null}
      </section>
      <section className="vip-stack-list" aria-label="Unverified comics">
        {model.items.length === 0 && !model.error ? <p className="vip-muted">No owned comics need verification.</p> : null}
        {model.items.map((item) => {
          const state = rows[item.id] ?? "open";
          return (
            <article key={item.id} className="vip-card" data-verify-item={item.id} data-state={state}>
              <header>
                <p className="vip-kicker">
                  <span className="vip-num">{item.position}</span>
                </p>
                <h2>{item.title}</h2>
                {item.detail ? <p className="vip-muted">{item.detail}</p> : null}
              </header>
              <div className="vip-card-flags">
                {state === "verified" ? (
                  <span className="vip-chip">Verified by you</span>
                ) : (
                  <span className="vip-chip vip-chip-review">Needs review</span>
                )}
                {item.isKeyIssue ? <span className="vip-chip vip-chip-caution">Key issue</span> : null}
              </div>
              {item.range ? (
                <>
                  <ValueRange {...item.range} />
                  <p className="vip-muted">Vendor guides · unverified · {item.guideSources}</p>
                </>
              ) : (
                <p className="vip-value-empty">No guide quote</p>
              )}
              {item.notes ? <p className="vip-muted">{item.notes}</p> : null}
              {state === "error" ? <p className="vip-callout">Save failed. The flag is unchanged.</p> : null}
              <div className="vip-action-row">
                {state === "verified" ? (
                  <button type="button" className="vip-button" onClick={() => void mark(item.id, true)}>
                    Undo
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="vip-button"
                      disabled={state === "saving"}
                      onClick={() => void mark(item.id, false)}
                    >
                      {state === "saving" ? "Saving…" : "Verified"}
                    </button>
                    <button
                      type="button"
                      className="vip-button"
                      disabled={state === "saving"}
                      onClick={() => void mark(item.id, true)}
                    >
                      {state === "kept" ? "Kept in review" : "Still needs review"}
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </section>
      {nextHref ? (
        <a className="vip-button" href={nextHref}>
          Next books in the queue
        </a>
      ) : null}
    </div>
  );
}
