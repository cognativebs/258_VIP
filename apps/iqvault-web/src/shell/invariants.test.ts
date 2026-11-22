import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const shellRoot = import.meta.dirname;
/** CSS colors. A catalog number such as #141 is not a color. */
const hex = /#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]*[A-Fa-f][0-9A-Fa-f]*)\b/;
const gap = "[\\s\\S]{0,40}";
const collectorOrder = new RegExp(`VAULT${gap}INGEST${gap}ADVISOR${gap}SIGNALS${gap}OPERATE`);
const dealerOrder = new RegExp(`OPERATE${gap}INGEST${gap}VAULT${gap}ADVISOR${gap}SIGNALS`);
const operateOrder = new RegExp(`sell${gap}listings${gap}transactions${gap}pricing`);
const rolesImport = /from\s+["'][^"']*\/roles["']/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return full;
  });
}

function sourceFiles(): string[] {
  return walk(shellRoot).filter((file) => /\.(ts|tsx|css)$/.test(file) && !/\.test\.tsx?$/.test(file));
}

describe("shell invariants", () => {
  it("keeps raw hex inside the tokens file", () => {
    const offenders = sourceFiles().filter((file) => {
      if (path.basename(file) === "tokens.css") return false;
      return hex.test(fs.readFileSync(file, "utf8"));
    });
    assert.deepEqual(offenders, []);
  });

  it("keeps concept order and operate order inside role config", () => {
    const offenders = sourceFiles().filter((file) => {
      if (path.basename(file) === "roles.ts") return false;
      const text = fs.readFileSync(file, "utf8");
      return collectorOrder.test(text) || dealerOrder.test(text) || operateOrder.test(text);
    });
    assert.deepEqual(offenders, []);
  });

  it("lets views read role context instead of importing the config module", () => {
    const offenders = sourceFiles().filter((file) => {
      const base = path.basename(file);
      if (base === "roles.ts" || base === "role-context.tsx") return false;
      return rolesImport.test(fs.readFileSync(file, "utf8"));
    });
    assert.deepEqual(offenders, []);
  });

  it("does not call the network from shell views", () => {
    const views = walk(path.join(shellRoot, "views")).filter((file) => file.endsWith(".tsx"));
    for (const file of views) {
      const text = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(text, /apiGet|fetch\(/);
    }
  });
});
