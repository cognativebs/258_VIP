export {
  ENGINE_VERSION,
  DEFAULT_RULE_CONFIG,
  RuleConfigSchema,
  EngineStanceSchema,
  DecisionInputSchema,
  EngineRecommendationSchema,
  type RuleConfig,
  type EngineStance,
  type DecisionInput,
  type EngineRecommendation,
  type MarketRangeResult,
  type LiquidityResult,
  type AllInCostResult,
  type TargetPriceResult,
  type EvidenceItem,
  type SaleComp,
} from "./types.js";

export { allInCost } from "./cost.js";
export { marketRange } from "./market-range.js";
export { liquidity } from "./liquidity.js";
export { targetPrice } from "./target-price.js";
export { recommend } from "./recommend.js";
export { signalsToEvidenceRefs, type SignalEvidenceInput } from "./evidence-bridge.js";

export {
  HISTORICAL_DECISIONS,
  loadHistoricalDecisions,
  HistoricalDecisionSchema,
  type HistoricalDecision,
} from "./backtest/fixture.js";
export {
  runBacktest,
  formatBacktestReport,
  type BacktestReport,
  type BacktestRow,
} from "./backtest/harness.js";
