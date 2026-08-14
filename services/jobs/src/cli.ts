import {
  formatEbayBrowseReport,
  runEbayBrowseCompsJob,
} from "./ebay-browse-comps.js";
import { formatDeltaReport, runPokemonDropsJobAsync } from "./pokemon-drops.js";
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
      ],
      { runImmediately: true },
    );
    console.log("Scheduler started (pokemon-drops). Ctrl+C to stop.");
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
