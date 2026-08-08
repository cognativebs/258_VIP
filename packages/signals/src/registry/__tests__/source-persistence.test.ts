import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isSourceActive,
  loadPersistedState,
  setSourceActive,
} from "../source-persistence.js";

describe("source-persistence", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("AT-03/AT-05: toggle persists and survives reload", () => {
    const dir = mkdtempSync(join(tmpdir(), "vip-src-"));
    dirs.push(dir);
    const path = join(dir, "sources-state.json");
    expect(isSourceActive("pokemon-news-rss", { defaultActive: true, statePath: path })).toBe(
      true,
    );
    setSourceActive("pokemon-news-rss", false, path);
    const reloaded = loadPersistedState(path);
    expect(reloaded["pokemon-news-rss"]?.active).toBe(false);
    expect(isSourceActive("pokemon-news-rss", { defaultActive: true, statePath: path })).toBe(
      false,
    );
  });
});
