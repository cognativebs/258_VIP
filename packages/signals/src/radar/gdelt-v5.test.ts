import { describe, expect, it } from "vitest";
import { isTripping, mayCall, recordOutcome, type Circuit } from "./circuit.js";
import {
  canonicalUrl,
  compileTerms,
  dateOfStamp,
  gramIndex,
  matchBatch,
  minuteStamps,
  normalizeText,
  parseToc,
  radarSnapshotJson,
  type WatchTerm,
} from "./gdelt-v5.js";
import { GdeltDocAdapter } from "../adapters/gdelt-doc-adapter.js";

// Shaped like the published files: TOC JSON lines; NGRAMS = DOCID \t QUADGRAM \t COUNT.
const TOC = [
  { ID: 1, date: "2026-10-17T19:32:00.000Z", img: "", lang: "en", title: "Pokémon Prismatic Evolutions restock hits stores", url: "https://news.example/pkmn?utm_source=x#top" },
  { ID: 2, date: "2026-10-17T19:32:00.000Z", img: "", lang: "en", title: "Best panini recipes for fall", url: "https://food.example/panini" },
  { ID: 3, date: "2026-10-17T19:32:00.000Z", img: "", lang: "en", title: "Topps loses NFL license", url: "https://cards.example/topps" },
  { ID: 4, date: "2026-10-17T19:32:00.000Z", img: "", lang: "en", title: "", url: "https://x.example/no-title" },
]
  .map((r) => JSON.stringify(r))
  .join("\n")
  .concat("\nnot json\n");
const NGRAMS = [
  "1\tthe Prismatic Evolutions booster\t2",
  "1\tbooster boxes sold out,\t1",
  "2\ta grilled Panini with\t1",
  "2\tmozzarella and fresh basil\t1",
  "3\tPanini and Fanatics trading\t1",
  "3\tFanatics trading cards rights\t1",
  "3\tcards rights for 2027\t1",
  "9\torphan doc not in toc\t1",
].join("\n");

const term = (t: Partial<WatchTerm> & { term: string }): WatchTerm => ({ tier: "D", domain: "collectibles", priority: 60, context: [], source: "seed", ...t });

describe("parsing and the gram index", () => {
  it("keeps TOC rows with a URL and a title, and indexes 1–4-word grams from quadgrams and the title", () => {
    const toc = parseToc(TOC);
    expect([...toc.keys()]).toEqual([1, 2, 3]);
    const grams = gramIndex(NGRAMS, toc);
    expect(grams.has(9)).toBe(false);
    expect(grams.get(1)!.has("prismatic evolutions")).toBe(true);
    expect(grams.get(1)!.has("pokemon prismatic evolutions restock")).toBe(true);
    expect(grams.get(1)!.has("sold out")).toBe(true);
    expect(normalizeText("Pokémon: Mega-Evolution!")).toBe("pokemon mega evolution");
  });
});

describe("matchBatch", () => {
  const toc = parseToc(TOC);
  const grams = gramIndex(NGRAMS, toc);

  it("needs a context word for single-word terms, so the sandwich is not a card company", () => {
    const matches = matchBatch(toc, grams, compileTerms([term({ term: "Panini", priority: 70 })]));
    expect(matches.map((m) => m.docId)).toEqual([3]);
  });

  it("matches multi-word terms without context, ranks by priority, and dedupes repeated terms", () => {
    const terms = compileTerms([
      term({ term: "Prismatic Evolutions", tier: "A", priority: 90, source: "binder" }),
      term({ term: "prismatic  evolutions", tier: "D", priority: 40 }),
      term({ term: "Topps", priority: 70 }),
      term({ term: "NFL license", domain: "sports_cards", priority: 80 }),
    ]);
    expect(terms).toHaveLength(3);
    const matches = matchBatch(toc, grams, terms);
    expect(matches.map((m) => [m.docId, m.domain, m.terms.map((t) => t.term)])).toEqual([
      [1, "collectibles", ["Prismatic Evolutions"]],
      [3, "sports_cards", ["NFL license", "Topps"]],
    ]);
    expect(matches[1]!.discoveryConfidence).toBe(0.85);
  });

  it("writes a snapshot the GDELT DOC adapter reads back, with the match record kept", () => {
    const matches = matchBatch(toc, grams, compileTerms([term({ term: "Topps" })]));
    const json = radarSnapshotJson("20261017193200", matches);
    const items = new GdeltDocAdapter({ sourceId: "gdelt_v5_ngrams", snapshotDir: ".", rateLimitMs: 0 }).parseSnapshot({ rawXml: json, fetchedAt: "2026-10-17T19:40:00Z" });
    expect(items).toMatchObject([{ title: "Topps loses NFL license", sourceUrl: "https://cards.example/topps", outlet: "cards.example", seenAt: expect.stringMatching(/^2026-10-17T19:32/) }]);
    expect(JSON.parse(json).articles[0].matchedTerms[0].term).toBe("Topps");
  });
});

describe("stamps and URLs", () => {
  it("lists minute stamps after the checkpoint, capped", () => {
    expect(minuteStamps(new Date("2026-10-17T19:30:40Z"), new Date("2026-10-17T19:33:00Z"))).toEqual(["20261017193100", "20261017193200", "20261017193300"]);
    expect(minuteStamps(new Date("2026-10-17T00:00:00Z"), new Date("2026-10-18T00:00:00Z"), 10)).toHaveLength(10);
    expect(dateOfStamp("20261017193200").toISOString()).toBe("2026-10-17T19:32:00.000Z");
  });

  it("drops tracking parameters and fragments", () => {
    expect(canonicalUrl("https://News.Example/a?utm_source=x&id=2#top")).toBe("https://news.example/a?id=2");
    expect(canonicalUrl("ftp://x/y")).toBeNull();
  });
});

describe("circuit breaker", () => {
  const closed: Circuit = { state: "closed", consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null, failureType: null, nextProbeAt: null };
  const t0 = new Date("2026-10-17T12:00:00Z");

  it("degrades on the first 429, opens on the second, probes once after 6 hours, closes on success", () => {
    const d = recordOutcome(closed, { ok: false, failureType: "HTTP 429" }, t0);
    expect(d.state).toBe("degraded");
    expect(mayCall(d, t0).call).toBe(true);
    const o = recordOutcome(d, { ok: false, failureType: "HTTP 429" }, t0);
    expect(o).toMatchObject({ state: "open", nextProbeAt: "2026-10-17T18:00:00.000Z" });
    expect(mayCall(o, new Date("2026-10-17T13:00:00Z"))).toEqual({ call: false, probe: false });
    expect(mayCall(o, new Date("2026-10-17T18:00:00Z"))).toEqual({ call: true, probe: true });
    expect(recordOutcome(o, { ok: false, failureType: "HTTP 503" }, new Date("2026-10-17T18:00:00Z")).nextProbeAt).toBe("2026-10-18T00:00:00.000Z");
    expect(recordOutcome(o, { ok: true }, new Date("2026-10-17T18:00:00Z"))).toMatchObject({ state: "closed", consecutiveFailures: 0 });
  });

  it("does not trip on a 404 or bad JSON", () => {
    expect(isTripping("HTTP 404")).toBe(false);
    expect(recordOutcome(closed, { ok: false, failureType: "GDELT returned a non-JSON answer" }, t0).state).toBe("closed");
  });
});
