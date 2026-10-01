import {
  formatEbayBrowseReport,
  runEbayBrowseCompsJob,
} from "./ebay-browse-comps.js";
import { formatClzSyncReport, runClzSyncJobAsync } from "./clz-sync.js";
import { Pool } from "pg";
import {
  formatEspnSportsReport,
  runEspnSportsJob,
  setEspnSourceEnabled,
} from "./espn-sports.js";
import { formatDeltaReport, runPokemonDropsJobAsync } from "./pokemon-drops.js";
import {
  classifyPendingEspnDocuments,
  formatSportsClassifierReport,
  openAiClassifier,
} from "./sports-classifier.js";
import {
  dsnFromEnv,
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

  if (cmd === "espn-sports") {
    const args = process.argv.slice(3);
    const sub = args.find((a) => !a.startsWith("--"));
    if (sub === "enable-source" || sub === "disable-source") {
      if (!args.includes("--confirm-operator")) {
        console.error(`${sub} changes vault_core.signals_news_source (HS-5). Re-run with --confirm-operator.`);
        process.exit(1);
      }
      const pool = new Pool({ connectionString: dsnFromEnv() });
      try {
        await setEspnSourceEnabled(pool, sub === "enable-source");
        console.log(`espn_rss ${sub === "enable-source" ? "enabled" : "disabled"} by operator.`);
      } finally {
        await pool.end();
      }
      return;
    }
    if (sub === "classify") {
      // The LLM is opt-in: it sends headline text to OpenAI. Without --llm the keyword rules decide.
      let llm = null;
      if (args.includes("--llm")) {
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
          console.error("--llm needs OPENAI_API_KEY.");
          process.exit(1);
        }
        llm = openAiClassifier({ apiKey, model: process.env.VIP_SIGNALS_CLASSIFIER_MODEL?.trim() || undefined });
      }
      const dryRun = args.includes("--dry-run");
      const pool = new Pool({ connectionString: dsnFromEnv() });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const report = await classifyPendingEspnDocuments(client, { llm });
        await client.query(dryRun ? "ROLLBACK" : "COMMIT");
        console.log(formatSportsClassifierReport(report));
        if (dryRun) console.log("dry run: rolled back, nothing written.");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
        await pool.end();
      }
      return;
    }
    const report = await runEspnSportsJob({ live: args.includes("--live") });
    console.log(formatEspnSportsReport(report));
    if (report.status === "failed") process.exit(1);
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
          name: "espn-sports",
          everyMs: 60 * 60 * 1000,
          run: () => {
            // Blocked until an operator enables espn_rss; the report says so.
            void runEspnSportsJob({ live: true }).then((report) => {
              console.log(formatEspnSportsReport(report));
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
      "Scheduler started (pokemon-drops hourly, espn-sports hourly, clz-sync every 6h, price-history daily). Ctrl+C to stop.",
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
