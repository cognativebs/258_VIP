import { PHASE_D_P_98_SENSITIVITY } from "@vip/core-model";
import { closeDb } from "./db/client.js";
import { loadLocalEnv } from "./lib/loadEnv.js";
import {
  evaluateGradingAtP98,
  formatAskCalibration,
  formatPhaseDContext,
  loadAskCalibrationRows,
  loadPhaseDContext,
  loadPremiumRows,
  summarizeAskCalibration,
} from "./lib/pricecharting/phaseD.js";

loadLocalEnv();

async function main() {
  const [asks, premiums, ctx] = await Promise.all([
    loadAskCalibrationRows(),
    loadPremiumRows(),
    loadPhaseDContext(),
  ]);
  console.log(formatAskCalibration(summarizeAskCalibration(asks)));
  console.log("");
  console.log(formatPhaseDContext(ctx));
  const highs = ctx.askDivergence.filter((r) => r.emitterKey === "ask_divergence_high");
  const lows = ctx.askDivergence.filter((r) => r.emitterKey === "ask_divergence_low");
  console.log(`context askDivergence high=${highs.length} low=${lows.length} (dollar-ranked)`);
  for (const row of ctx.askDivergence) {
    console.log(
      `  ${row.emitterKey} $${row.evidence.dollarDivergence} ratio=${row.evidence.ratio} ` +
        `ask=${row.evidence.medianAsk} guide=${row.evidence.guidePrice} n=${row.evidence.listingCount}`,
    );
  }

  const usable = premiums.filter((row) => row.raw > 0 && row.high > 0);
  const positiveAt = Object.fromEntries(
    PHASE_D_P_98_SENSITIVITY.map((p) => [
      p,
      usable.filter((row) => evaluateGradingAtP98(row, p).expectedIncrementalProfit > 0),
    ]),
  ) as Record<number, typeof usable>;
  const intersection = usable.filter((row) =>
    PHASE_D_P_98_SENSITIVITY.every((p) => evaluateGradingAtP98(row, p).expectedIncrementalProfit > 0),
  );
  console.log("");
  console.log(
    `grading sensitivity bothRungs=${usable.length} ` +
      `P0.10=${positiveAt[0.1]?.length ?? 0} P0.20=${positiveAt[0.2]?.length ?? 0} P0.30=${positiveAt[0.3]?.length ?? 0} ` +
      `intersection=${intersection.length}`,
  );
  console.log("intersection queue (positive-EV at 0.10, 0.20, and 0.30):");
  for (const row of ctx.gradingArbitrage) {
    console.log(
      `  ${row.evidence.recommendation} ${row.evidence.canonicalName ?? row.assetId} ` +
        `p10=$${row.evidence.profitAtP10} p20=$${row.evidence.profitAtP20} p30=$${row.evidence.profitAtP30} ` +
        `ratio=${row.evidence.ratio} year=${row.evidence.yearBegan ?? "?"} ` +
        `pre1975=${row.evidence.pre1975PressRestorationRisk} notes=${row.notes}`,
    );
  }
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
