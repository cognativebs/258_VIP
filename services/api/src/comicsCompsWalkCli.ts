import { join } from "node:path";
import { loadLocalEnv } from "./lib/loadEnv.js";
import {
  formatComicsCompsWalkReport,
  parsePublishers,
  runComicsCompsWalk,
} from "./lib/comps/comicsCompsWalk.js";
import { memoryListingObservationStore, postgresListingObservationStore } from "./lib/comps/listingObservation.js";

loadLocalEnv();

function argValue(argv: string[], name: string): string | undefined {
  const flag = argv.find((a) => a.startsWith(`--${name}=`));
  return flag ? flag.slice(name.length + 3).trim() : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const publishers = parsePublishers(argValue(argv, "publishers"));
  const maxRaw = argValue(argv, "max-holdings");
  const staleRaw = argValue(argv, "stale-hours");
  const dryRun = hasFlag(argv, "dry-run");
  const resume = hasFlag(argv, "resume");
  const cursorPath =
    argValue(argv, "cursor") ??
    process.env.VIP_COMICS_COMPS_CURSOR ??
    join(process.cwd(), ".state", "comics-comps-walk.json");

  const store = dryRun ? memoryListingObservationStore() : postgresListingObservationStore();
  let paused = false;
  const onSig = () => {
    paused = true;
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  const result = await runComicsCompsWalk({
    publishers,
    maxHoldings: maxRaw ? Number(maxRaw) : undefined,
    staleAfterHours: staleRaw ? Number(staleRaw) : 24,
    dryRun,
    resume,
    cursorPath,
    store,
    shouldStop: () => paused,
    triggeredBy: "cli",
  });
  console.log(formatComicsCompsWalkReport(result));
  if (result.cursor.paused || (result.stoppedReason && /HTTP|OAuth|invalid_/.test(result.stoppedReason))) {
    process.exitCode = 2;
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
