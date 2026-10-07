import { confidenceLabel, formatUsdRange, rangeSpreadRatio } from "../format";
import { conceptHref } from "../routes";
import type { ConfidenceWord } from "../schemas";

export function ValueRange({
  low,
  high,
  compCount,
  recencyDays,
  confidence,
  evidenceLabel = "comps",
}: {
  low: number | null;
  high: number | null;
  compCount: number;
  recencyDays: number | null;
  confidence: ConfidenceWord;
  evidenceLabel?: "comps" | "listings";
}) {
  if (confidence === "none" || low == null || high == null) {
    return (
      <div className="vip-value" data-confidence="none">
        <p className="vip-value-empty">No matched comps</p>
        <a className="vip-text-action" href={conceptHref("ADVISOR")}>
          Ask Advisor
        </a>
      </div>
    );
  }

  const spread = rangeSpreadRatio(low, high);
  return (
    <div className="vip-value" data-confidence={confidence} data-spread={spread.toFixed(3)}>
      <p className="vip-num vip-value-range">{formatUsdRange(low, high)}</p>
      <div className="vip-spread" aria-hidden="true">
        <span className="vip-spread-fill" style={{ width: `${Math.round(spread * 100)}%` }} />
      </div>
      <p className="vip-value-meta">
        <span className="vip-num">{compCount}</span> {evidenceLabel}
        <span className="vip-dot">·</span>
        {recencyDays == null ? (
          "recency unknown"
        ) : (
          <span className="vip-num">{Math.round(recencyDays)}d</span>
        )}
        <span className="vip-dot">·</span>
        {confidenceLabel(confidence)}
      </p>
    </div>
  );
}
