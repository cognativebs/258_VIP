import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandPalette, paletteReducer } from "./components/CommandPalette";
import { ConceptNav } from "./components/ConceptNav";
import { ValueRange } from "./components/ValueRange";
import { ShellFrame } from "./AppShell";
import type { IngestFlowModel } from "./ingest/types";
import type { AdvisorModel, IngestModel, OperateModel, SignalsModel, VaultModel } from "./live/load";
import { popoutLinks } from "@/lib/popoutLinks";
import { getRole } from "./roles";
import { RoleProvider } from "./role-context";
import { conceptFromPath } from "./routes";
import { insufficientEvidenceSchema, roleIdSchema, valueRangeSchema, type RoleId } from "./schemas";
import { SEARCH_RANKING_CONTRACT } from "./search/contract";
import { stubSearchResolver } from "./search/stub";
import { AdvisorView } from "./views/AdvisorView";
import { HomeView } from "./views/HomeView";
import { IngestView } from "./views/IngestView";
import { OperateView } from "./views/OperateView";
import { SignalsView } from "./views/SignalsView";
import { VaultView } from "./views/VaultView";

function renderRole(roleId: RoleId, node: ReactNode): string {
  return renderToStaticMarkup(<RoleProvider initialRoleId={roleId}>{node}</RoleProvider>);
}

const vault: VaultModel = {
  error: null,
  notice: null,
  sourceNote: "snapshot · 1d · abc",
  coverage: {
    byAssetCovered: 1,
    byAssetTotal: 2,
    byAssetPercent: 50,
    byValueNote: "By value is not computed. A snapshot total is not a range.",
  },
  assets: [
    {
      id: "priced",
      name: "Priced holding",
      detail: "Pub · Series · 1",
      category: "Comics",
      needsReview: false,
      verification: { verified: true },
      range: {
        low: 10,
        high: 14,
        compCount: 12,
        recencyDays: 3,
        confidence: "high",
        evidenceLabel: "listings",
      },
    },
    {
      id: "open",
      name: "Open holding",
      detail: "",
      category: "Comics",
      needsReview: true,
      verification: { verified: false, label: "NM assumed · unverified" },
      range: {
        low: null,
        high: null,
        compCount: 0,
        recencyDays: null,
        confidence: "none",
        evidenceLabel: "listings",
      },
    },
  ],
};

const advisor: AdvisorModel = {
  error: null,
  notice: null,
  returned: 2,
  answers: [
    {
      kind: "range",
      id: "a1",
      name: "Held copy",
      action: "Hold · Hold",
      range: {
        low: 20,
        high: 40,
        compCount: 4,
        recencyDays: 6,
        confidence: "medium",
        evidenceLabel: "comps",
      },
      limiter: "decision-engine. Confidence band medium.",
      sources: ["Four matched sales."],
      counterEvidence: ["Condition is unverified."],
    },
    {
      kind: "insufficient",
      id: "a2",
      name: "Unpriced copy",
      insufficient: {
        reason: "Unpriced copy: no matched sales, so there is no range.",
        facts: ["INSUFFICIENT_MARKET_EVIDENCE"],
        actions: [
          { label: "Open the vault", href: "/vault" },
          { label: "Open ingest", href: "/ingest" },
        ],
      },
    },
  ],
};

const signals: SignalsModel = {
  error: null,
  notice: null,
  source: "job_feed",
  items: [
    {
      id: "s1",
      category: "reprint",
      title: "Reprint noted",
      body: "A reprint was reported.",
      date: "2026-09-01",
      quarantine: "active",
      linkage: {
        status: "resolved",
        whyVipCares: "Linked holding Copy. The signal annotates that holding. It is not a price.",
        holdingName: "Copy",
        range: {
          low: null,
          high: null,
          compCount: 0,
          recencyDays: null,
          confidence: "none",
          evidenceLabel: "listings",
        },
      },
    },
    {
      id: "s2",
      category: "news",
      title: "Unlinked note",
      body: "No holding id on this item.",
      date: "2026-09-02",
      quarantine: "active",
      linkage: {
        status: "unavailable",
        note: "Portfolio impact is unavailable. This signal has no holding id on the feed.",
        originTitle: "news",
      },
    },
  ],
};

const flow: IngestFlowModel = {
  error: null,
  destinationId: null,
  destinations: [
    { id: "personal_collection", label: "Personal Collection" },
    { id: "investment_vault", label: "Investment" },
    { id: "dealer_inventory", label: "Dealer Inventory" },
  ],
  subtargetKind: "",
  subtargetId: "",
  binders: [],
  hunts: [],
  methodKey: null,
  methods: [
    { key: "scanner_hid", label: "Scanner (live)", enabled: true },
    { key: "api_import", label: "API import", enabled: false, disabledReason: "No sources connected" },
  ],
  query: "",
  batches: [],
  pausedNotice: null,
  detail: null,
  captureError: null,
  duplicateNotice: null,
  confirmDraft: "",
  commitNote: null,
  csvText: "",
  csvPresetId: null,
  presets: [],
  csv: null,
};

const ingest: IngestModel = {
  error: null,
  stage: "Review",
  batchName: "ricoh · 2026-09-20",
  gateNote:
    "Pokémon top-1 accuracy is not scored. MTG top-1 accuracy is not scored. False auto-confirm rate is not recorded. Auto-confirm threshold is not on the batch.",
  units: [
    {
      id: "u1",
      title: "Unit 1 · review",
      note: "Top confidence 0.42.",
      candidates: [{ id: "c1", label: "Unnamed candidate", confidence: 0.42 }],
    },
  ],
};

const operate: OperateModel = {
  sellError: null,
  sell: [],
  listingsError: null,
  listings: [],
  transactionsError: null,
  transactions: [],
};

describe("required states", () => {
  it("renders a tight high-confidence range and a wider low-confidence range", () => {
    const tightHtml = renderToStaticMarkup(
      <ValueRange low={120} high={130} compCount={12} recencyDays={3} confidence="high" evidenceLabel="comps" />,
    );
    const wideHtml = renderToStaticMarkup(
      <ValueRange low={40} high={220} compCount={2} recencyDays={61} confidence="low" evidenceLabel="comps" />,
    );
    const tightSpread = Number(tightHtml.match(/data-spread="([0-9.]+)"/)?.[1]);
    const wideSpread = Number(wideHtml.match(/data-spread="([0-9.]+)"/)?.[1]);
    assert.ok(wideSpread > tightSpread);
    assert.match(tightHtml, /12/);
    assert.match(tightHtml, /3d/);
    assert.match(tightHtml, /High/);
    assert.match(wideHtml, /2/);
    assert.match(wideHtml, /61d/);
    assert.match(wideHtml, /Low/);
  });

  it("renders no matched comps as an action, not a dollar figure", () => {
    const html = renderToStaticMarkup(
      <ValueRange low={null} high={null} compCount={0} recencyDays={null} confidence="none" />,
    );
    assert.match(html, /No matched comps/);
    assert.match(html, /Ask Advisor/);
    assert.doesNotMatch(html, /\$/);
  });

  it("rejects a scalar value on the range schema", () => {
    const parsed = valueRangeSchema.safeParse({
      value: 412,
      low: 400,
      high: 420,
      compCount: 4,
      recencyDays: 2,
      confidence: "high",
    });
    assert.equal(parsed.success, false);
  });

  it("shows an unverified chip only on the unverified holding, and leaves needs review open", () => {
    const html = renderToStaticMarkup(<VaultView model={vault} />);
    assert.equal(html.match(/NM assumed · unverified/g)?.length, 1);
    assert.match(html, /Needs review/);
    assert.doesNotMatch(html, /resolved/i);
    assert.match(html, /By asset/);
    assert.match(html, /By value is not computed/);
    assert.match(html, /50%/);
    assert.doesNotMatch(html, /42%/);
    assert.doesNotMatch(html, /18%/);
  });

  it("renders a full advisor answer and an insufficient-evidence answer with actions", () => {
    const html = renderToStaticMarkup(<AdvisorView model={advisor} />);
    assert.match(html, /Evidence/);
    assert.match(html, /Sources used/);
    assert.match(html, /Counter-evidence/);
    assert.match(html, /What would change this/);
    assert.match(html, /Save prediction/);
    assert.match(html, /No prediction log is connected/);
    assert.match(html, /Not enough evidence to answer/);
    assert.match(html, /href="\/ingest"/);
    assert.match(html, /href="\/vault"/);
    assert.match(html, /vip-insufficient/);
    const empty = insufficientEvidenceSchema.safeParse({
      reason: "No comps",
      facts: ["None matched"],
      actions: [],
    });
    assert.equal(empty.success, false);
  });

  it("renders linked signals and a lineage fallback without invented meters", () => {
    const html = renderToStaticMarkup(<SignalsView model={signals} />);
    assert.match(html, /Why VIP cares/);
    assert.match(html, /Portfolio impact is unavailable/);
    assert.match(html, /One source on this feed/);
    assert.match(html, /Fact confidence and attention are not on this feed/);
    assert.doesNotMatch(html, /0\.18/);
    assert.doesNotMatch(html, /0\.91/);
    assert.doesNotMatch(html, /\$\d/);
  });

  it("states that auto-confirm figures are not on the batch", () => {
    const html = renderToStaticMarkup(<IngestView model={flow} />);
    assert.match(html, /Auto-confirm threshold is not on the batch/);
    assert.match(html, /False auto-confirm rate is not recorded/);
    assert.doesNotMatch(html, /0\.90/);
    assert.doesNotMatch(html, /No candidate above threshold/);
    assert.match(html, /Review/);
  });

  it("opens an empty command palette that does not invent hits", () => {
    const html = renderToStaticMarkup(<CommandPalette open onClose={() => undefined} />);
    assert.match(html, /Search is not connected yet/);
    assert.match(html, /data-group="holding"/);
    assert.match(html, /data-group="signal"/);
    assert.match(html, /data-group="conversation"/);
    assert.doesNotMatch(html, /Amazing Fantasy/);
  });

  it("moves the palette cursor by keyboard and ignores enter", () => {
    const opened = paletteReducer({ open: false, activeIndex: 0 }, { type: "toggle" });
    assert.equal(opened.open, true);
    const next = paletteReducer(opened, { type: "next", count: 6 });
    assert.equal(next.activeIndex, 1);
    const entered = paletteReducer(next, { type: "enter" });
    assert.deepEqual(entered, next);
    const closed = paletteReducer(entered, { type: "close" });
    assert.equal(closed.open, false);
  });

  it("renders every screen under each role order", () => {
    const screens = [
      <HomeView key="home" vault={vault} signals={signals} ingest={ingest} />,
      <VaultView key="vault" model={vault} />,
      <IngestView key="ingest" model={flow} />,
      <AdvisorView key="advisor" model={advisor} />,
      <SignalsView key="signals" model={signals} />,
      <OperateView key="operate" model={operate} sectionId="listings" />,
    ];
    for (const roleId of roleIdSchema.options) {
      const role = getRole(roleId);
      const nav = renderToStaticMarkup(<ConceptNav order={role.order} active={role.landing} />);
      const concepts = [...nav.matchAll(/data-concept="([A-Z]+)"/g)].map((match) => match[1]);
      assert.deepEqual(concepts, [...role.order]);
      for (const screen of screens) {
        const html = renderRole(roleId, screen);
        assert.ok(html.length > 80);
      }
      const listings = renderRole(roleId, <OperateView model={operate} sectionId="listings" />);
      assert.match(listings, /No listing drafts/);
      assert.doesNotMatch(listings, /No workflow is connected/);
      const pricing = renderRole(roleId, <OperateView model={operate} sectionId="pricing" />);
      assert.match(pricing, /No workflow is connected/);
      const sections = [...listings.matchAll(/data-section="([^"]+)"/g)].map((match) => match[1]);
      assert.deepEqual(sections, role.secondary.OPERATE.map((section) => section.id));
    }
    assert.deepEqual([...getRole("founder").order], [...getRole("collector").order]);
    assert.equal(getRole("founder").landing, getRole("collector").landing);
    assert.equal(getRole("dealer").landing, "OPERATE");
    assert.notDeepEqual([...getRole("dealer").order], [...getRole("collector").order]);
  });

  it("tolerates a shorter concept order", () => {
    const html = renderToStaticMarkup(
      <ConceptNav order={["OPERATE", "INGEST", "VAULT"]} active="OPERATE" />,
    );
    assert.equal([...html.matchAll(/data-concept=/g)].length, 3);
  });

  it("reads the active concept from the path", () => {
    assert.equal(conceptFromPath("/vault"), "VAULT");
    assert.equal(conceptFromPath("/operate/sell"), "OPERATE");
    assert.equal(conceptFromPath("/home"), "HOME");
    assert.equal(conceptFromPath("/signals-feed"), null);
    assert.equal(conceptFromPath("/collections/comics"), null);
  });

  it("renders the dealer shell from role config", () => {
    const html = renderRole("dealer", <ShellFrame pathname="/operate">desk</ShellFrame>);
    const concepts = [...html.matchAll(/data-concept="([A-Z]+)"/g)].map((match) => match[1]);
    assert.deepEqual(concepts, [...getRole("dealer").order]);
    assert.match(html, /data-role="dealer"/);
    assert.match(html, /href="\/home"/);
    assert.match(html, /aria-label="Companion apps"/);
    for (const link of popoutLinks()) {
      assert.match(html, new RegExp(`href="${link.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
      assert.match(html, new RegExp(`>${link.label}<`));
    }
  });

  it("documents search as an entity-layer contract and returns nothing", async () => {
    assert.match(SEARCH_RANKING_CONTRACT, /entity layer/i);
    assert.match(SEARCH_RANKING_CONTRACT, /Holdings/);
    assert.match(SEARCH_RANKING_CONTRACT, /not comparable/i);
    const response = await stubSearchResolver("amazing");
    assert.equal(response.connected, false);
    assert.deepEqual(response.results, []);
    assert.equal(response.notice, "Search is not connected yet");
  });
});
