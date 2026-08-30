import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";

export const SCAN_OCR_RULE = "scan-ocr-tesseract@0.1.0";

export type OcrResult = {
  text: string;
  confidence: number;
  engine: string;
  ms: number;
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

function runTesseract(bin: string, imagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [imagePath, "stdout", "--psm", "6", "-l", "eng"], {
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `tesseract exited ${code}`));
    });
  });
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

export async function ocrImageFile(
  imagePath: string,
  cacheKey?: string,
): Promise<OcrResult> {
  const key = cacheKey ?? imagePath;
  const hit = cache.get(key);
  if (hit) return hit;
  const empty: OcrResult = { text: "", confidence: 0, engine: "none", ms: 0 };
  if (process.env.VIP_SCAN_OCR === "0") {
    cache.set(key, empty);
    return empty;
  }
  const t0 = Date.now();
  for (const bin of tesseractBinaries()) {
    if (bin !== "tesseract" && !existsSync(bin)) continue;
    try {
      const raw = await runTesseract(bin, imagePath);
      const text = raw.replace(/\s+/g, " ").trim();
      const result: OcrResult = {
        text,
        confidence: text.length > 8 ? 0.7 : text ? 0.4 : 0,
        engine: bin === "tesseract" ? "tesseract-cli" : bin,
        ms: Date.now() - t0,
      };
      cache.set(key, result);
      return result;
    } catch {
      // try next binary
    }
  }
  const miss = { ...empty, ms: Date.now() - t0, engine: "unavailable" };
  cache.set(key, miss);
  return miss;
}

export function clearOcrCache(): void {
  cache.clear();
}
