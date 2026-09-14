import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { z } from "zod";
import {
  BreakEvenInputSchema,
  COMP_CHECK_META,
  COMP_CHECK_STEPS,
  COMP_RED_FLAGS,
  COMP_SOURCES,
  DEALER_KIT_VERSION,
  FlipDealInputSchema,
  GRADING_FEE_TIERS,
  PRICECHARTING_TOKEN_ENV,
  SAMPLE_STORE_SKUS,
  StoreSkuSchema,
  compCheckDeskHtml,
  compCheckFieldHtml,
  evaluateBreakEven,
  flipExamplesCsv,
  flipScoreGuideHtml,
  gradingCalculatorXml,
  listTiers,
  lookupPriceCharting,
  notionFlipTemplate,
  notionStoreBase,
  pricechartingTokenFromEnv,
  runFlipExamples,
  sealedPricingHtml,
  scoreFlipDeal,
  scoreStoreBook,
  walkthroughScriptMd,
} from "@vip/dealer-kit";

function fail(res: Response, e: unknown): void {
  if (e instanceof ZodError) {
    const detail = e.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    res.status(400).json({ error: detail });
    return;
  }
  res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
}

const LookupQuerySchema = z.object({
  q: z.string().optional(),
  id: z.string().optional(),
  upc: z.string().optional(),
  category: z.enum(["sports", "tcg", "comics", "sealed", "other"]).optional(),
  list: z.enum(["1", "true", "yes"]).optional(),
});

export function registerDealerKitRoutes(app: Express): void {
  app.get("/api/tools/catalog", (_req: Request, res: Response) => {
    res.json({
      version: DEALER_KIT_VERSION,
      pricecharting: {
        tokenEnv: PRICECHARTING_TOKEN_ENV,
        configured: Boolean(pricechartingTokenFromEnv()),
        note: "Valuation adapter only. Idle without a paid token. Guide values are not sold comps.",
      },
      products: [
        { id: "flip-score", title: "The Flip Score Deal Sheet", priceUsd: 37, href: "/tools/flip-score" },
        { id: "grading", title: "Break-Even Grading Calculator", priceUsd: 19, href: "/tools/grading" },
        { id: "comp-check", title: "The 90-Second Comp Check", priceUsd: 12, href: "/tools/comp-check" },
        { id: "store", title: "Card Store Inventory & Margin System", priceUsd: 147, href: "/tools/store-inventory" },
        {
          id: "course",
          title: "From Collector to Dealer",
          priceUsd: 197,
          href: "/tools/collector-to-dealer",
          note: "Syllabus only — film after the cheaper products have receipts.",
        },
      ],
    });
  });

  app.post("/api/tools/flip-score", (req: Request, res: Response) => {
    try {
      const input = FlipDealInputSchema.parse(req.body);
      res.json(scoreFlipDeal(input));
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/tools/flip-score/examples", (_req: Request, res: Response) => {
    res.json({
      version: DEALER_KIT_VERSION,
      note: "Teaching snapshots. Comp dollars are manual · unverified. PriceCharting ids are real.",
      examples: runFlipExamples().map(({ example, result }) => ({ example, result })),
    });
  });

  app.post("/api/tools/grading-breakeven", (req: Request, res: Response) => {
    try {
      const input = BreakEvenInputSchema.parse(req.body);
      res.json(evaluateBreakEven(input));
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/tools/grading-fees", (req: Request, res: Response) => {
    const grader = typeof req.query.grader === "string" ? req.query.grader : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const includePaused = req.query.includePaused === "1";
    res.json({
      version: DEALER_KIT_VERSION,
      tiers: listTiers({
        grader: grader as "PSA" | "CGC" | "BGS" | undefined,
        category: category as "cards" | "comics" | undefined,
        includePaused,
      }),
      all: includePaused ? GRADING_FEE_TIERS : listTiers({ includePaused: false }),
    });
  });

  app.get("/api/tools/comp-check", (_req: Request, res: Response) => {
    res.json({
      ...COMP_CHECK_META,
      steps: COMP_CHECK_STEPS,
      sources: COMP_SOURCES,
      redFlags: COMP_RED_FLAGS,
    });
  });

  app.post("/api/tools/store-inventory", (req: Request, res: Response) => {
    try {
      const skus = z.array(StoreSkuSchema).parse(req.body?.skus ?? SAMPLE_STORE_SKUS);
      res.json(scoreStoreBook(skus));
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/tools/store-inventory/sample", (_req: Request, res: Response) => {
    res.json(scoreStoreBook(SAMPLE_STORE_SKUS));
  });

  app.get("/api/tools/pricecharting", async (req: Request, res: Response) => {
    try {
      const q = LookupQuerySchema.parse(req.query);
      if (!q.q && !q.id && !q.upc) {
        res.status(400).json({ error: "Provide q, id, or upc" });
        return;
      }
      const result = await lookupPriceCharting({
        q: q.q,
        id: q.id,
        upc: q.upc,
        category: q.category,
        list: Boolean(q.list),
      });
      if (!result.ok) {
        res.status(result.status && result.status >= 400 ? result.status : 200).json({
          idle: !pricechartingTokenFromEnv(),
          emptyReason: result.emptyReason,
          products: [],
        });
        return;
      }
      res.json({
        idle: false,
        product: result.product,
        products: result.products ?? [result.product],
        emptyReason: null,
      });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/tools/export/:file", (req: Request, res: Response) => {
    const file = req.params.file;
    if (file === "flip-examples.csv") {
      res.type("text/csv").send(flipExamplesCsv());
      return;
    }
    if (file === "flip-notion.md") {
      res.type("text/markdown").send(notionFlipTemplate(runFlipExamples()));
      return;
    }
    if (file === "flip-guide.html") {
      res.type("html").send(flipScoreGuideHtml());
      return;
    }
    if (file === "grading-calculator.xls") {
      res.type("application/vnd.ms-excel").send(gradingCalculatorXml());
      return;
    }
    if (file === "comp-desk.html") {
      res.type("html").send(compCheckDeskHtml());
      return;
    }
    if (file === "comp-field.html") {
      res.type("html").send(compCheckFieldHtml());
      return;
    }
    if (file === "store-notion.md") {
      res.type("text/markdown").send(notionStoreBase());
      return;
    }
    if (file === "sealed-pricing.html") {
      res.type("html").send(sealedPricingHtml());
      return;
    }
    if (file === "store-walkthrough.md") {
      res.type("text/markdown").send(walkthroughScriptMd());
      return;
    }
    res.status(404).json({ error: `Unknown export ${file}` });
  });
}
