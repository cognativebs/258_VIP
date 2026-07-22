import { formatDeltaReport, runPokemonDropsJob } from "./pokemon-drops.js";
import { startScheduler } from "./scheduler.js";

const cmd = process.argv[2] ?? "pokemon-drops";

if (cmd === "pokemon-drops") {
  const { delta } = runPokemonDropsJob({ triggeredBy: "cli" });
  console.log(formatDeltaReport(delta));
  process.exit(0);
}

if (cmd === "schedule") {
  // Dev cadence: every hour. Gate tests use direct job invocation (no manual prompts).
  const handle = startScheduler(
    [
      {
        name: "pokemon-drops",
        everyMs: 60 * 60 * 1000,
        run: () => {
          const { delta } = runPokemonDropsJob({ triggeredBy: "schedule" });
          console.log(formatDeltaReport(delta));
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
} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}
