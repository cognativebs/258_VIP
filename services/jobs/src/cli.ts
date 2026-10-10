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
import { formatMacroNewsReport, GDELT_SOURCE_KEY, runMacroNewsJob } from "./macro-news.js";
import { disableNewsSource, enableNewsSource, listNewsSources } from "./news-source-admin.js";
import {
  checkMemberAccess,
  formatPokebeachReport,
  listTrackedMembers,
  pokebeachFixtureReport,
  runPokebeachBackfill,
  runPokebeachDiscovery,
  runPokebeachOfficial,
  runPokebeachReconcile,
  updateTrackedMember,
  type OfficialReport,
  type Queryable as PokebeachQueryable,
} from "./pokebeach.js";
import { extractSourceItemEntities, formatEntityReport } from "./pokemon-entities.js";
import { formatIndexReport, indexFeedItems } from "./source-items.js";
import { formatCrossSourceJoinReport, joinOutletItems } from "./cross-source-join.js";
import { confirmMatch, formatPokemonPricesReport, listReview, loadApiEnv, runPokemonPrices } from "./pokemon-prices.js";
import { formatComicbaseImport, runComicbaseImport } from "./comicbase-import.js";
import { formatPriceChartingSnapshotReport, runPriceChartingSnapshotJob } from "./pricecharting-snapshot.js";
import { clusterPokebeachItems, formatClusterReport } from "./pokebeach-cluster.js";

/** One transaction per PokéBeach run: items, revisions, fetch state and raw rows land together or not at all. */
async function inPokebeachTransaction<T>(fn: (db: PokebeachQueryable) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: dsnFromEnv() });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

const jitter = (maxMs: number) => new Promise((r) => setTimeout(r, Math.random() * maxMs));
import {
  COLLECTIBLES_SOURCE_KEYS,
  formatCollectiblesNewsReport,
  runCollectiblesNewsJob,
} from "./collectibles-news.js";
import {
  classifyPendingDocuments,
  classifyPendingEspnDocuments,
  formatSportsClassifierReport,
  openAiClassifier,
  type HeadlineClassifierReport,
  type LlmClassifier,
  type Queryable,
} from "./sports-classifier.js";

/** Shared by every news job's `classify` subcommand. The LLM is opt-in: it sends headline text to OpenAI. */
/** Scheduled classification: rules only (no LLM, operator 2026-10-10), one transaction, report printed. */
async function classifyRulesOnly(
  label: string,
  classify: (db: Queryable, llm: LlmClassifier | null) => Promise<HeadlineClassifierReport>,
): Promise<void> {
  try {
    const report = await inPokebeachTransaction((db) => classify(db as unknown as Queryable, null));
    console.log(formatSportsClassifierReport(report));
  } catch (e) {
    console.error(`${label} classify failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function runClassify(
  args: string[],
  classify: (db: Queryable, llm: LlmClassifier | null) => Promise<HeadlineClassifierReport>,
) {
  let llm: LlmClassifier | null = null;
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
    const report = await classify(client, llm);
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
}
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
      await runClassify(args, (db, llm) => classifyPendingEspnDocuments(db, { llm }));
      return;
    }
    const report = await runEspnSportsJob({ live: args.includes("--live") });
    console.log(formatEspnSportsReport(report));
    if (report.status === "failed") process.exit(1);
    return;
  }

  if (cmd === "macro-news") {
    const args = process.argv.slice(3);
    if (args.find((a) => !a.startsWith("--")) === "classify") {
      await runClassify(args, (db, llm) =>
        classifyPendingDocuments(db, {
          sourceKeys: [GDELT_SOURCE_KEY],
          ruleSetName: "macro-headline",
          job: "macro-classifier",
          llm,
        }),
      );
      return;
    }
    const report = await runMacroNewsJob({ live: args.includes("--live") });
    console.log(formatMacroNewsReport(report));
    if (report.status === "failed") process.exit(1);
    return;
  }

  if (cmd === "pokemon-prices") {
    // pokemon-prices [--dry-run] [--limit N] | review | confirm <externalId> [productId] --confirm-operator
    loadApiEnv();
    const args = process.argv.slice(3);
    if (args[0] === "review") {
      const rows = await inPokebeachTransaction((db) => listReview(db));
      if (!rows.length) console.log("No PriceCharting matches waiting for review.");
      for (const r of rows) console.log(`${r.externalId.padEnd(14)} → ${r.productId.padEnd(10)} ${r.productName}  (${r.reason ?? ""})`);
      return;
    }
    if (args[0] === "confirm") {
      if (!args[1] || !args.includes("--confirm-operator")) {
        console.error("usage: pokemon-prices confirm <externalId> [productId] --confirm-operator");
        process.exit(1);
      }
      const productId = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
      const ok = await inPokebeachTransaction((db) => confirmMatch(db, args[1]!, productId));
      console.log(ok ? `${args[1]} confirmed; it is priced on the next run.` : `No PriceCharting match found for ${args[1]}.`);
      return;
    }
    const i = args.indexOf("--limit");
    const report = await inPokebeachTransaction((db) =>
      runPokemonPrices(db, { dryRun: args.includes("--dry-run"), limit: i >= 0 ? Number(args[i + 1]) : undefined }),
    );
    console.log(formatPokemonPricesReport(report));
    return;
  }

  if (cmd === "pricecharting-snapshot") {
    // pricecharting-snapshot [--csv=<file>] [--dry-run] — nightly guide CSV → guide_price_observation (ADR 0012).
    // Scheduled by the Windows task from scripts/schedule_pricecharting_snapshot.ps1, not the launcher's scheduler.
    loadApiEnv();
    const csvFlag = process.argv.slice(3).find((a) => a.startsWith("--csv="));
    const report = await runPriceChartingSnapshotJob({
      triggeredBy: "cli",
      csvPath: csvFlag ? csvFlag.slice("--csv=".length) : undefined,
      dryRun: process.argv.includes("--dry-run"),
    });
    console.log(formatPriceChartingSnapshotReport(report));
    return;
  }

  if (cmd === "items") {
    // items index [--days N] | items extract — feed snapshots → source items → Pokémon entities (manual: groundwork for cross-source clustering)
    const args = process.argv.slice(3);
    const i = args.indexOf("--days");
    if (args[0] === "index") {
      console.log(formatIndexReport(await inPokebeachTransaction((db) => indexFeedItems(db, { days: i >= 0 ? Number(args[i + 1]) : 7 }))));
      return;
    }
    if (args[0] === "extract") {
      console.log(formatEntityReport(await inPokebeachTransaction((db) => extractSourceItemEntities(db))));
      return;
    }
    if (args[0] === "join") {
      // Outlet headlines join existing Pokémon events as independent sources (never start one).
      console.log(formatCrossSourceJoinReport(await inPokebeachTransaction((db) => joinOutletItems(db))));
      return;
    }
    console.error("usage: items index [--days N] | items extract | items join");
    process.exit(1);
  }

  if (cmd === "pokebeach") {
    // pokebeach official | discover | extract | cluster | reconcile | backfill [--days N] | fixtures
    //           members [list] | members set "<handle>" [--profile-url URL] [--weight key=0.8 ...] [--tracked on|off] --confirm-operator
    //           members check --confirm-operator
    const args = process.argv.slice(3);
    const sub = args[0];
    const flag = (name: string) => {
      const i = args.indexOf(name);
      return i >= 0 ? args[i + 1] : undefined;
    };
    const print = (r: OfficialReport) => {
      console.log(formatPokebeachReport(r));
      if (r.status === "failed") process.exitCode = 1;
    };
    if (sub === "fixtures") {
      console.log(JSON.stringify(pokebeachFixtureReport(), null, 2));
      return;
    }
    if (sub === "official") return print(await inPokebeachTransaction((db) => runPokebeachOfficial(db)));
    if (sub === "discover") return print(await inPokebeachTransaction((db) => runPokebeachDiscovery(db)));
    if (sub === "extract") {
      console.log(formatEntityReport(await inPokebeachTransaction((db) => extractSourceItemEntities(db))));
      return;
    }
    if (sub === "cluster") {
      console.log(formatClusterReport(await inPokebeachTransaction((db) => clusterPokebeachItems(db))));
      return;
    }
    if (sub === "reconcile") return print(await inPokebeachTransaction((db) => runPokebeachReconcile(db)));
    if (sub === "backfill") {
      const days = Number(flag("--days") ?? 90);
      return print(await inPokebeachTransaction((db) => runPokebeachBackfill(db, {}, { days })));
    }
    if (sub === "members") {
      const action = args[1] && !args[1].startsWith("--") ? args[1] : "list";
      if (action === "list") {
        for (const m of await inPokebeachTransaction((db) => listTrackedMembers(db))) {
          const w = m.weights;
          console.log(
            `${m.tracked ? "tracked" : "off    "} ${m.handle.padEnd(22)} news ${w.news} · sealed ${w.sealed} · collecting ${w.collecting} · competitive ${w.competitive} · market ${w.market} (${m.weightsFrom}) · ${m.profileUrl ?? "(no profile URL)"}`,
          );
        }
        return;
      }
      if (!args.includes("--confirm-operator")) {
        console.error(`members ${action} changes member configuration or makes requests to PokéBeach. Re-run with --confirm-operator.`);
        process.exit(1);
      }
      if (action === "set" && args[2]) {
        const weights: Record<string, number> = {};
        args.forEach((a, i) => {
          if (a === "--weight") {
            const [k, v] = String(args[i + 1]).split("=");
            weights[k!] = Number(v);
          }
        });
        const tracked = flag("--tracked");
        const m = await inPokebeachTransaction((db) =>
          updateTrackedMember(db, args[2]!, {
            profileUrl: flag("--profile-url"),
            tracked: tracked === undefined ? undefined : tracked === "on",
            weights: Object.keys(weights).length ? weights : undefined,
          }),
        );
        console.log(`${m.handle}: ${m.tracked ? "tracked" : "off"} · ${JSON.stringify(m.weights)} · ${m.profileUrl ?? "(no profile URL)"}`);
        return;
      }
      if (action === "check") {
        const results = await inPokebeachTransaction((db) => checkMemberAccess(db));
        for (const r of results) console.log(`${r.result.padEnd(15)} ${r.handle.padEnd(22)} ${r.status ?? ""} ${r.url ?? ""}`);
        if (results.some((r) => r.result === "blocked")) {
          console.log("At least one member page is blocked. Member tracking stays off; nothing will try to get around it.");
        }
        return;
      }
    }
    console.error("usage: pokebeach official | discover | extract | cluster | reconcile | backfill [--days N] | fixtures | members [list|set|check]");
    process.exit(1);
  }

  if (cmd === "news-source") {
    // news-source list | enable <key> [--endpoint https://...] --confirm-operator | disable <key> --confirm-operator
    const args = process.argv.slice(3);
    const [sub, key] = args.filter((a) => !a.startsWith("--") && !/^https?:/.test(a));
    const pool = new Pool({ connectionString: dsnFromEnv() });
    try {
      if (sub === "list" || !sub) {
        for (const s of await listNewsSources(pool)) {
          console.log(`${s.enabled ? "ON " : "off"} ${s.sourceKey.padEnd(26)} ${s.endpoint ?? "(no endpoint)"}${s.blockedReason ? ` — ${s.blockedReason}` : ""}`);
        }
        return;
      }
      if ((sub === "enable" || sub === "disable") && key) {
        if (!args.includes("--confirm-operator")) {
          console.error(`${sub} changes vault_core.signals_news_source (HS-5). Confirm the source's terms, then re-run with --confirm-operator.`);
          process.exit(1);
        }
        if (sub === "disable") {
          await disableNewsSource(pool, key);
          console.log(`${key} disabled by operator.`);
          return;
        }
        const i = args.indexOf("--endpoint");
        const s = await enableNewsSource(pool, { sourceKey: key, endpoint: i >= 0 ? args[i + 1] : undefined });
        console.log(`${s.sourceKey} enabled by operator · ${s.endpoint}`);
        return;
      }
      console.error("usage: news-source list | enable <key> [--endpoint https://...] --confirm-operator | disable <key> --confirm-operator");
      process.exit(1);
    } finally {
      await pool.end();
    }
  }

  if (cmd === "collectibles-news") {
    const args = process.argv.slice(3);
    if (args.find((a) => !a.startsWith("--")) === "classify") {
      await runClassify(args, (db, llm) =>
        classifyPendingDocuments(db, {
          sourceKeys: [...COLLECTIBLES_SOURCE_KEYS],
          ruleSetName: "collectibles-headline",
          job: "collectibles-classifier",
          llm,
        }),
      );
      return;
    }
    const report = await runCollectiblesNewsJob({ live: args.includes("--live") });
    console.log(formatCollectiblesNewsReport(report));
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

  if (cmd === "schedule" || cmd === "items" || cmd === "pokebeach") {
    // Entity extraction may learn set names from TCGdex's public set list (cached 6 h).
    process.env.VIP_ENTITY_TCGDEX_SETS ??= "1";
  }

  if (cmd === "schedule") {
    // schedule [--skip name,name] — e.g. --skip price-history while TCGplayer answers 403
    const k = process.argv.indexOf("--skip");
    const skip = new Set(k >= 0 ? String(process.argv[k + 1] ?? "").split(",").map((x) => x.trim()).filter(Boolean) : []);
    const jobs: Parameters<typeof startScheduler>[0] = [
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
            // Blocked until an operator enables espn_rss; the report says so. New headlines are then
            // classified by rules (unmatched ones stay stored, unclassified).
            void runEspnSportsJob({ live: true })
              .then((report) => console.log(formatEspnSportsReport(report)))
              .then(() => classifyRulesOnly("espn-sports", (db, llm) => classifyPendingEspnDocuments(db, { llm })));
          },
        },
        {
          name: "collectibles-news",
          everyMs: 60 * 60 * 1000,
          run: () => {
            // Each source stays blocked until an operator enables it; the report says so.
            void runCollectiblesNewsJob({ live: true })
              .then((report) => console.log(formatCollectiblesNewsReport(report)))
              .then(() =>
                classifyRulesOnly("collectibles-news", (db, llm) =>
                  classifyPendingDocuments(db, {
                    sourceKeys: [...COLLECTIBLES_SOURCE_KEYS],
                    ruleSetName: "collectibles-headline",
                    job: "collectibles-classifier",
                    llm,
                  }),
                ),
              )
              .catch((e) => console.error(`collectibles-news failed: ${e instanceof Error ? e.message : e}`));
          },
        },
        {
          name: "macro-news",
          everyMs: 60 * 60 * 1000,
          run: () => {
            // Blocked until an operator enables gdelt_doc_v2; the report says so.
            void runMacroNewsJob({ live: true })
              .then((report) => console.log(formatMacroNewsReport(report)))
              .then(() =>
                classifyRulesOnly("macro-news", (db, llm) =>
                  classifyPendingDocuments(db, { sourceKeys: [GDELT_SOURCE_KEY], ruleSetName: "macro-headline", job: "macro-classifier", llm }),
                ),
              )
              .catch((e) => console.error(`macro-news failed: ${e instanceof Error ? e.message : e}`));
          },
        },
        {
          name: "pokebeach",
          everyMs: 30 * 60 * 1000,
          run: () => {
            // Blocked until an operator enables pokebeach_official; jittered so polls never land on the same second.
            void jitter(5 * 60 * 1000)
              .then(() =>
                inPokebeachTransaction(async (db) => {
                  const reports = [await runPokebeachOfficial(db), await runPokebeachDiscovery(db)];
                  const entities = await extractSourceItemEntities(db);
                  return { reports, entities, clusters: await clusterPokebeachItems(db) };
                }),
              )
              .then(({ reports, entities, clusters }) => {
                reports.forEach((r) => console.log(formatPokebeachReport(r)));
                console.log(formatEntityReport(entities));
                console.log(formatClusterReport(clusters));
              })
              .catch((e) => console.error(`pokebeach failed: ${e instanceof Error ? e.message : e}`));
          },
        },
        {
          name: "comicbase-import",
          everyMs: 60 * 60 * 1000,
          run: () => {
            // New ComicBase exports in VIP_COMICBASE_INBOX → review list; unchanged files are skipped.
            loadApiEnv();
            void runComicbaseImport()
              .then((r) => console.log(formatComicbaseImport(r)))
              .catch((e) => console.error(`comicbase-import failed: ${e instanceof Error ? e.message : e}`));
          },
        },
        {
          name: "items",
          everyMs: 60 * 60 * 1000,
          run: () => {
            // Outlet headlines → items → Pokémon entities → join matching Pokémon events (operator 2026-10-10).
            void jitter(10 * 60 * 1000)
              .then(() =>
                inPokebeachTransaction(async (db) => ({
                  index: await indexFeedItems(db),
                  entities: await extractSourceItemEntities(db),
                  joined: await joinOutletItems(db),
                })),
              )
              .then(({ index, entities, joined }) => {
                console.log(formatIndexReport(index));
                console.log(formatEntityReport(entities));
                console.log(formatCrossSourceJoinReport(joined));
              })
              .catch((e) => console.error(`items failed: ${e instanceof Error ? e.message : e}`));
          },
        },
        {
          name: "pokemon-prices",
          everyMs: 24 * 60 * 60 * 1000,
          run: () => {
            // Daily PriceCharting guide for Binder wants and signal cards; idle without a token.
            loadApiEnv();
            void jitter(30 * 60 * 1000)
              .then(() => inPokebeachTransaction((db) => runPokemonPrices(db)))
              .then((r) => console.log(formatPokemonPricesReport(r)))
              .catch((e) => console.error(`pokemon-prices failed: ${e instanceof Error ? e.message : e}`));
          },
        },
        {
          name: "pokebeach-reconcile",
          everyMs: 24 * 60 * 60 * 1000,
          run: () => {
            void jitter(10 * 60 * 1000)
              .then(() => inPokebeachTransaction((db) => runPokebeachReconcile(db)))
              .then((r) => console.log(formatPokebeachReport(r)))
              .catch((e) => console.error(`pokebeach-reconcile failed: ${e instanceof Error ? e.message : e}`));
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
    ];
    const unknown = [...skip].filter((n) => !jobs.some((j) => j.name === n));
    if (unknown.length) {
      console.error(`unknown job(s) for --skip: ${unknown.join(", ")} (jobs: ${jobs.map((j) => j.name).join(", ")})`);
      process.exit(1);
    }
    const running = jobs.filter((j) => !skip.has(j.name));
    // One job's stray rejection or throw is logged; it never takes the other jobs down with it.
    process.on("unhandledRejection", (reason) => {
      console.error(`[scheduler] unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
    });
    process.on("uncaughtException", (err) => {
      console.error(`[scheduler] uncaught exception: ${err.stack ?? err.message}`);
    });
    const heartbeat = setInterval(() => console.log(`[scheduler] alive ${new Date().toISOString()}`), 60 * 60 * 1000);
    void heartbeat;
    const handle = startScheduler(running, { runImmediately: true });
    console.log(
      "Scheduler started (pokebeach every 30m; pokemon-drops, espn-sports, collectibles-news, macro-news, items and comicbase-import hourly; clz-sync every 6h; price-history, pokemon-prices and pokebeach-reconcile daily). Ctrl+C to stop.",
    );
    if (skip.size) console.log(`Skipped: ${[...skip].join(", ")}`);
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
