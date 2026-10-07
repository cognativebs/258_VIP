import { loadLocalEnv } from "./loadEnv.js";
import {
  formatComicsBrowseWalkReport,
  runComicsBrowseWalkJob,
} from "./comics-browse-walk.js";
import {
  formatEbayBrowseReport,
  runEbayBrowseCompsJob,
} from "./ebay-browse-comps.js";
import { formatClzDiffReport, runClzDiffJobAsync } from "./clz-diff.js";
import { formatClzSyncReport, runClzSyncJobAsync } from "./clz-sync.js";
import { formatDeltaReport, runPokemonDropsJobAsync } from "./pokemon-drops.js";
import {
  formatPriceHistoryReport,
  parseArgs as parsePriceHistoryArgs,
  runPriceHistoryJob,
} from "./price-history.js";
import {
  formatPriceChartingSnapshotReport,
  runPriceChartingSnapshotJob,
} from "./pricecharting-snapshot.js";
import { startScheduler } from "./scheduler.js";

loadLocalEnv();

const cmd = process.argv[2] ?? "pokemon-drops";

async function main() {
  if (cmd === "pokemon-drops") {
    const { delta } = await runPokemonDropsJobAsync({ triggeredBy: "cli" });
    console.log(formatDeltaReport(delta));
    return;
  }

  if (cmd === "ebay-browse-comps") {
    const argv = process.argv.slice(3);
    const hasQuery = argv.some((a) => a.startsWith("--query=")) || Boolean(process.env.VIP_EBAY_QUERY?.trim());
    if (!hasQuery) {
      const walk = await runComicsBrowseWalkJob({ resume: true, triggeredBy: "cli" });
      console.log(formatComicsBrowseWalkReport(walk));
      return;
    }
    const result = await runEbayBrowseCompsJob({
      triggeredBy: "cli",
      argv,
    });
    console.log(formatEbayBrowseReport(result));
    return;
  }

  if (cmd === "clz-diff") {
    const result = await runClzDiffJobAsync({
      triggeredBy: "cli",
      extraArgs: process.argv.slice(3),
    });
    console.log(formatClzDiffReport(result));
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

  if (cmd === "pricecharting-snapshot") {
    const csvFlag = process.argv.slice(3).find((a) => a.startsWith("--csv="));
    const report = await runPriceChartingSnapshotJob({
      triggeredBy: "cli",
      csvPath: csvFlag ? csvFlag.slice("--csv=".length) : undefined,
      dryRun: process.argv.includes("--dry-run"),
    });
    console.log(formatPriceChartingSnapshotReport(report));
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
        {
          name: "pricecharting-snapshot",
          everyMs: 24 * 60 * 60 * 1000,
          run: () => {
            void runPriceChartingSnapshotJob({ triggeredBy: "schedule" }).then((report) => {
              console.log(formatPriceChartingSnapshotReport(report));
            });
          },
        },
        {
          name: "comics-browse-walk",
          everyMs: 24 * 60 * 60 * 1000,
          run: () => {
            void runComicsBrowseWalkJob({ resume: true, triggeredBy: "schedule" }).then((result) => {
              console.log(formatComicsBrowseWalkReport(result));
            });
          },
        },
        {
          name: "clz-diff",
          everyMs: 24 * 60 * 60 * 1000,
          run: () => {
            void runClzDiffJobAsync({ triggeredBy: "schedule" }).then((result) => {
              console.log(formatClzDiffReport(result));
            });
          },
        },
      ],
      { runImmediately: true },
    );
    console.log(
      "Scheduler started (pokemon-drops hourly, clz-sync every 6h, price-history + pricecharting-snapshot + comics-browse-walk + clz-diff daily). Ctrl+C to stop.",
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
