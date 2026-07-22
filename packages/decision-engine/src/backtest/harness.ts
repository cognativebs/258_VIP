import { ENGINE_VERSION, type EngineStance } from "../types.js";
import { recommend } from "../recommend.js";
import {
  HISTORICAL_DECISIONS,
  loadHistoricalDecisions,
  type HistoricalDecision,
} from "./fixture.js";

export type Agreement = "agree" | "disagree" | "soft_agree";

export interface BacktestRow {
  id: string;
  label: string;
  actualStance: EngineStance;
  engineStance: EngineStance;
  agreement: Agreement;
  outcome: HistoricalDecision["outcome"];
  confidence: number;
  reasonCodes: string[];
  range: string;
  /** Engine disagreed with a historically bad human call — valuable. */
  flagsBadCall: boolean;
  supportingCount: number;
  opposingCount: number;
}

export interface BacktestReport {
  engineVersion: string;
  total: number;
  agree: number;
  softAgree: number;
  disagree: number;
  flaggedBadCalls: number;
  rows: BacktestRow[];
}

function agreement(actual: EngineStance, engine: EngineStance): Agreement {
  if (actual === engine) return "agree";
  if (
    (actual === "Watch" && engine === "Pass") ||
    (actual === "Pass" && engine === "Watch")
  ) {
    return "soft_agree";
  }
  return "disagree";
}

export function runBacktest(
  decisions: HistoricalDecision[] = loadHistoricalDecisions(HISTORICAL_DECISIONS),
): BacktestReport {
  const rows: BacktestRow[] = decisions.map((d) => {
    const rec = recommend(d.input);
    const agr = agreement(d.actualStance, rec.stance);
    const flagsBadCall =
      d.outcome === "bad" &&
      ((d.actualStance === "Buy" && rec.stance !== "Buy") ||
        (d.actualStance !== "Buy" && rec.stance === "Buy"));

    const r = rec.marketRange;
    return {
      id: d.id,
      label: d.label,
      actualStance: d.actualStance,
      engineStance: rec.stance,
      agreement: agr,
      outcome: d.outcome,
      confidence: rec.confidence,
      reasonCodes: rec.reasonCodes,
      range:
        r && r.matchedSales > 0
          ? `$${r.low}–$${r.high} (n=${r.matchedSales})`
          : "insufficient",
      flagsBadCall,
      supportingCount: rec.supportingEvidence.length,
      opposingCount: rec.opposingEvidence.length,
    };
  });

  return {
    engineVersion: ENGINE_VERSION,
    total: rows.length,
    agree: rows.filter((r) => r.agreement === "agree").length,
    softAgree: rows.filter((r) => r.agreement === "soft_agree").length,
    disagree: rows.filter((r) => r.agreement === "disagree").length,
    flaggedBadCalls: rows.filter((r) => r.flagsBadCall).length,
    rows,
  };
}

export function formatBacktestReport(report: BacktestReport): string {
  const lines = [
    `VIP Decision Engine Backtest — ${report.engineVersion}`,
    `Total: ${report.total}  Agree: ${report.agree}  Soft: ${report.softAgree}  Disagree: ${report.disagree}  Flagged bad calls: ${report.flaggedBadCalls}`,
    "",
  ];
  for (const row of report.rows) {
    lines.push(
      `[${row.id}] ${row.agreement.toUpperCase()}${row.flagsBadCall ? " FLAG_BAD" : ""}  actual=${row.actualStance} engine=${row.engineStance}  ${row.range}  conf=${row.confidence}`,
    );
    lines.push(`  ${row.label}`);
    lines.push(`  reasons: ${row.reasonCodes.join(", ")}`);
  }
  return lines.join("\n");
}
