import {
  formatEbayBrowseReport,
  runEbayBrowseCompsJob,
} from "./ebay-browse-comps.js";
import { formatClzSyncReport, runClzSyncJobAsync } from "./clz-sync.js";
import { formatDeltaReport, runPokemonDropsJobAsync } from "./pokemon-drops.js";
import {
  formatPriceHistoryReport,
  parseArgs as parsePriceHistoryArgs,
  runPriceHistoryJob,
} from "./price-history.js";
import { startScheduler } from "./scheduler.js";

const cmd = process.argv[2] ?? "pokemon-drops";

async function main() {
  if (cmd === "pokemon-drops") {
    const { delta } = await runPokemonDropsJobAsync({ triggeredBy: "cli" });
    console.log(formatDeltaReport(delta));
    return;
  }

  if (cmd === "ebay-browse-comps") {
    const result = await runEbayBrowseCompsJob({
      triggeredBy: "cli",
      argv: process.argv.slice(3),
    });
    console.log(formatEbayBrowseReport(result));
    return;
  }

  if (cmd === "clz-sync") {
    const extraArgs = process.argv.slice(3);
    const result = await runClzSyncJobAsync({
      triggeredBy: "cli",
      extraArgs,
    });
    console.log(formatClzSyncReport(result));
    return;
  }

  if (cmd === "price-history") {
    const report = await runPriceHistoryJob({
      ...parsePriceHistoryArgs(process.argv.slice(3)),
      triggeredBy: "cli",
    });
    console.log(formatPriceHistoryReport(report));
    return;
  }

  if (cmd === "schedule") {
    const handle = startScheduler(
      [
        {
          name: "pokemon-drops",
          everyMs: 60 * 60 * 1000,
          run: () => {
            void runPokemonDropsJobAsync({ triggeredBy: "schedule" }).then(({ delta }) => {
              console.log(formatDeltaReport(delta));
            });
          },
        },
        {
          name: "clz-sync",
          everyMs: 6 * 60 * 60 * 1000,
          run: () => {
            void runClzSyncJobAsync({ triggeredBy: "schedule" }).then((result) => {
              console.log(formatClzSyncReport(result));
            });
          },
        },
        {
          name: "price-history",
          everyMs: 24 * 60 * 60 * 1000,
          run: () => {
            void runPriceHistoryJob({ triggeredBy: "schedule" }).then((report) => {
              console.log(formatPriceHistoryReport(report));
            });
          },
        },
      ],
      { runImmediately: true },
    );
    console.log(
      "Scheduler started (pokemon-drops hourly, clz-sync every 6h, price-history daily). Ctrl+C to stop.",
    );
    process.on("SIGINT", () => {
      handle.stop();
      process.exit(0);
    });
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
