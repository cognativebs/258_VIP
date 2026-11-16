import type { InsufficientEvidenceProps } from "../schemas";

/** A designed answer, styled caution. Actions are required so it is not a dead end. */
export function InsufficientEvidence({ reason, facts, actions }: InsufficientEvidenceProps) {
  return (
    <section className="vip-insufficient" aria-label="Not enough evidence">
      <p className="vip-kicker">Not enough evidence to answer</p>
      <p className="vip-insufficient-reason">{reason}</p>
      <ul className="vip-fact-list">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      <div className="vip-action-row">
        {actions.map((action) => (
          <a key={action.href + action.label} className="vip-button" href={action.href}>
            {action.label}
          </a>
        ))}
      </div>
    </section>
  );
}
