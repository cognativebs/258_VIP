import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load gitignored KEY=VALUE files into process.env without overriding
 * values already set (user env / setx wins).
 */
export function parseEnvFile(text: string): Record<string, string> {
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

export function applyEnvFile(text: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parseEnvFile(text))) {
    if (env[key] != null && String(env[key]).trim() !== "") continue;
    env[key] = value;
    applied.push(key);
  }
  return applied;
}

function hereDir() {
  return dirname(fileURLToPath(import.meta.url));
}

/** Candidate paths: cwd .env, repo services/api/.env, this package .env. */
export function localEnvPaths(cwd = process.cwd()): string[] {
  return [
    join(cwd, ".env"),
    join(cwd, "services", "api", ".env"),
    join(hereDir(), "..", "..", ".env"),
  ];
}

export function loadLocalEnv(cwd = process.cwd()): { files: string[]; keys: string[] } {
  const files: string[] = [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const path of localEnvPaths(cwd)) {
    if (seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    const applied = applyEnvFile(readFileSync(path, "utf8"));
    files.push(path);
    keys.push(...applied);
  }
  return { files, keys };
}
