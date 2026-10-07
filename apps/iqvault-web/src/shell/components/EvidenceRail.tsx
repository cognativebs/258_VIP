export function EvidenceRail({
  confidence,
  limiter,
  sources,
  counterEvidence,
  whatWouldChange,
  saved,
  onSave,
}: {
  confidence: string;
  limiter: string;
  sources: string[];
  counterEvidence: string[];
  whatWouldChange: string[];
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <aside className="vip-rail vip-rail-right" aria-label="Evidence">
      <section>
        <p className="vip-kicker">Confidence</p>
        <p className="vip-rail-lead">{confidence}</p>
        <p className="vip-muted">{limiter}</p>
      </section>
      <section>
        <p className="vip-kicker">Sources used</p>
        <ul className="vip-plain-list">
          {sources.map((source) => (
            <li key={source}>{source}</li>
          ))}
        </ul>
      </section>
      <section>
        <p className="vip-kicker">Counter-evidence</p>
        <ul className="vip-plain-list">
          {counterEvidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section>
        <p className="vip-kicker">What would change this</p>
        <ul className="vip-plain-list">
          {whatWouldChange.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section>
        <p className="vip-kicker">Save as prediction</p>
        <button type="button" className="vip-button" onClick={onSave}>
          {saved ? "Noted here only" : "Save prediction"}
        </button>
        {saved ? <p className="vip-muted">Not written. No prediction log is connected.</p> : null}
      </section>
    </aside>
  );
}
