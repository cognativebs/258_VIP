import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { identifyFromPairedImages } from "./identifyFromImages.js";
import { baseVsParallelFromEvidence } from "./evidenceFusion.js";
import { routeReview, thresholdsFromEnv } from "./reviewRoute.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main(): Promise<void> {
  const folder = resolve(arg("--folder", "data/scan-inbox/pixel-id-v1"));
  const files = readdirSync(folder)
    .filter((n) => /\.(jpe?g|png)$/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  console.log(`# Card Image Identification v1`);
  console.log(`Folder: ${folder}`);
  console.log(`Images: ${files.length}`);
  console.log("");
  console.log(
    "| Card | Player | Year | Set | Number | Base | Parallel | PConf | Status | Why | OCR regions |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");

  const thresholds = thresholdsFromEnv();
  let i = 0;
  let card = 1;
  while (i < files.length) {
    const front = files[i]!;
    const back = files[i + 1];
    const result = await identifyFromPairedImages({
      frontPath: join(folder, front),
      backPath: back ? join(folder, back) : null,
      frontFileName: front,
      backFileName: back,
      categoryHint: "sports",
    });
    const split = baseVsParallelFromEvidence(result.evidence);
    const route = routeReview({
      baseConfidence: split.baseConfidence,
      conflict: result.evidence.conflictNotes.length > 0,
      pairingNeedsReview: false,
      thresholds,
    });
    const f = result.evidence.fused;
    const why = (result.evidence.debug?.whyWon ?? "").replace(/\|/g, "/");
    const kinds = [
      ...(result.evidence.debug?.rawOcr.frontSpans ?? []),
      ...(result.evidence.debug?.rawOcr.backSpans ?? []),
    ]
      .map((s) => s.kind)
      .filter((k, i, a) => a.indexOf(k) === i)
      .join(",");
    console.log(
      `| ${card} | ${f.playerOrCharacter.value ?? "unknown"} | ${f.year.value ?? "—"} | ${f.setName.value ?? f.brand.value ?? "—"} | ${f.collectorNumber.value ?? "—"} | ${split.baseConfidence.toFixed(2)} | ${split.parallelDisplayName ?? "unknown"} | ${split.parallelConfidence.toFixed(2)} | ${route} | ${why || "—"} | ${kinds || "—"} |`,
    );
    i += 2;
    card += 1;
  }
}

void main();
