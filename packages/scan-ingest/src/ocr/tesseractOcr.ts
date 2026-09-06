import { execFileSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { platform } from "node:os";
import {
  classifyOcrSpans,
  type OcrSpan,
} from "./classifyOcr.js";

export const SCAN_OCR_RULE = "scan-ocr-tesseract@0.2.0";

export type OcrResult = {
  text: string;
  confidence: number;
  engine: string;
  ms: number;
  spans: OcrSpan[];
};

const cache = new Map<string, OcrResult>();

function tesseractBinaries(): string[] {
  const fromEnv = process.env.VIP_SCAN_TESSERACT?.trim();
  const extras =
    platform() === "win32"
      ? [
          "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
          "C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe",
        ]
      : [];
  return [fromEnv, "tesseract", ...extras].filter((x): x is string => Boolean(x));
}

function runTesseract(
  bin: string,
  imagePath: string,
  extraArgs: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [imagePath, "stdout", ...extraArgs], {
      windowsHide: true,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("tesseract timed out"));
    }, 8_000);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `tesseract exited ${code}`));
    });
  });
}

/** Tesseract TSV: level page block par line word left top width height conf text */
export function spansFromTsv(tsv: string): OcrSpan[] {
  const groups = new Map<
    string,
    { texts: string[]; left: number; top: number; right: number; bottom: number; confs: number[] }
  >();
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length < 12) continue;
    if (cols[0] !== "5") continue;
    const text = (cols[11] ?? "").trim();
    if (!text) continue;
    const left = Number(cols[6]);
    const top = Number(cols[7]);
    const width = Number(cols[8]);
    const height = Number(cols[9]);
    const conf = Number(cols[10]);
    const key = `${cols[1]}-${cols[2]}-${cols[3]}-${cols[4]}`;
    const g = groups.get(key) ?? {
      texts: [],
      left,
      top,
      right: left + width,
      bottom: top + height,
      confs: [],
    };
    g.texts.push(text);
    g.left = Math.min(g.left, left);
    g.top = Math.min(g.top, top);
    g.right = Math.max(g.right, left + width);
    g.bottom = Math.max(g.bottom, top + height);
    if (!Number.isNaN(conf) && conf >= 0) g.confs.push(conf);
    groups.set(key, g);
  }
  const lines = [...groups.values()].map((g) => ({
    text: g.texts.join(" "),
    bbox: {
      x: g.left,
      y: g.top,
      w: Math.max(0, g.right - g.left),
      h: Math.max(0, g.bottom - g.top),
    },
    confidence: g.confs.length
      ? g.confs.reduce((s, n) => s + n, 0) / g.confs.length / 100
      : null,
  }));
  return classifyOcrSpans(lines);
}

function textFromSpans(spans: OcrSpan[]): string {
  return spans.map((s) => s.text).join("\n").trim();
}

let availableCache: boolean | null = null;

export function ocrAvailable(): boolean {
  if (process.env.VIP_SCAN_OCR === "0") return false;
  if (availableCache != null) return availableCache;
  for (const bin of tesseractBinaries()) {
    if (bin !== "tesseract" && !existsSync(bin)) continue;
    try {
      execFileSync(bin, ["--version"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 4000,
      });
      availableCache = true;
      return true;
    } catch {
      // try next binary
    }
  }
  availableCache = false;
  return false;
}

export function resetOcrAvailableCache(): void {
  availableCache = null;
}

const EMPTY: OcrResult = {
  text: "",
  confidence: 0,
  engine: "none",
  ms: 0,
  spans: [],
};

export async function ocrImageFile(
  imagePath: string,
  cacheKey?: string,
): Promise<OcrResult> {
  const key = cacheKey ?? imagePath;
  const hit = cache.get(key);
  if (hit) return hit;
  if (process.env.VIP_SCAN_OCR === "0") {
    cache.set(key, EMPTY);
    return EMPTY;
  }
  try {
    if (statSync(imagePath).size < 2048) {
      const tiny = { ...EMPTY, engine: "skipped-tiny" };
      cache.set(key, tiny);
      return tiny;
    }
  } catch {
    cache.set(key, EMPTY);
    return EMPTY;
  }
  const t0 = Date.now();
  for (const bin of tesseractBinaries()) {
    if (bin !== "tesseract" && !existsSync(bin)) continue;
    try {
      let spans: OcrSpan[] = [];
      try {
        const tsv = await runTesseract(bin, imagePath, ["-l", "eng", "--psm", "6", "tsv"]);
        spans = spansFromTsv(tsv);
      } catch {
        const raw = await runTesseract(bin, imagePath, ["-l", "eng", "--psm", "6"]);
        const lines = raw
          .split(/\r?\n/)
          .map((t) => t.trim())
          .filter(Boolean);
        spans = classifyOcrSpans(lines.map((text) => ({ text })));
      }
      const text = textFromSpans(spans);
      const result: OcrResult = {
        text,
        confidence: text.length > 8 ? 0.7 : text ? 0.4 : 0,
        engine: bin === "tesseract" ? "tesseract-cli" : bin,
        ms: Date.now() - t0,
        spans,
      };
      cache.set(key, result);
      return result;
    } catch {
      // try next binary
    }
  }
  const miss = { ...EMPTY, ms: Date.now() - t0, engine: "unavailable" };
  cache.set(key, miss);
  return miss;
}

export function clearOcrCache(): void {
  cache.clear();
}
