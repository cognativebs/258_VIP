import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cut = line.indexOf("=");
    if (cut <= 0) continue;
    const key = line.slice(0, cut).trim();
    let value = line.slice(cut + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

export function loadLocalEnv(cwd = process.cwd()): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const paths = [
    join(cwd, ".env"),
    join(cwd, "services", "api", ".env"),
    join(here, "..", "..", "api", ".env"),
  ];
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    for (const [key, value] of Object.entries(parseEnvFile(readFileSync(path, "utf8")))) {
      if (process.env[key] != null && String(process.env[key]).trim() !== "") continue;
      process.env[key] = value;
    }
  }
}
