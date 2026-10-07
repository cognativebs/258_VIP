export type ReviewCandidate = {
  id: string;
  label: string;
  confidence: number;
};

export function ReviewRow({
  title,
  candidates,
  threshold,
  selected,
  onSelect,
}: {
  title: string;
  candidates: ReviewCandidate[];
  threshold: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const above = threshold == null || candidates.some((candidate) => candidate.confidence >= threshold);
  return (
    <button type="button" className={selected ? "vip-review-row is-selected" : "vip-review-row"} onClick={onSelect}>
      <span className="vip-review-title">{title}</span>
      {candidates.map((candidate) => (
        <span key={candidate.id} className="vip-candidate">
          <span className="vip-candidate-label">{candidate.label}</span>
          <span className="vip-candidate-bar" aria-hidden="true">
            <span
              className={
                threshold != null && candidate.confidence >= threshold
                  ? "vip-candidate-fill is-above"
                  : "vip-candidate-fill"
              }
              style={{ width: `${Math.round(candidate.confidence * 100)}%` }}
            />
          </span>
          <span className="vip-num">{candidate.confidence.toFixed(2)}</span>
        </span>
      ))}
      {above ? null : <span className="vip-review-miss">No candidate above threshold</span>}
    </button>
  );
}
