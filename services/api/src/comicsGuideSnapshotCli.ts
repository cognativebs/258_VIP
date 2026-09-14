import { loadLocalEnv } from "./lib/loadEnv.js";
import { formatComicsCompsWalkReport } from "./lib/comps/comicsCompsWalk.js";
import { runComicsGuideSnapshot } from "./lib/comps/comicsGuideSnapshot.js";

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
  const maxRaw = argValue(argv, "max-holdings");
  let paused = false;
  const onSig = () => {
    paused = true;
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  const result = await runComicsGuideSnapshot({
    maxHoldings: maxRaw ? Number(maxRaw) : undefined,
    dryRun: hasFlag(argv, "dry-run"),
    resume: hasFlag(argv, "resume"),
    cursorPath: argValue(argv, "cursor"),
    shouldStop: () => paused,
  });
  console.log(formatComicsCompsWalkReport(result));
  if (result.cursor.paused || (result.stoppedReason && /HTTP|OAuth|invalid_|TOKEN/.test(result.stoppedReason))) {
    process.exitCode = 2;
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
