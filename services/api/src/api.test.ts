import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = createApp();
  const server = app.listen(0);
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("VIP API", () => {
  it("serves inventory with provenance on holdings", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/inventory`);
      const body = (await res.json()) as {
        holdings: { provenance: { method: string } }[];
      };
      expect(res.status).toBe(200);
      expect(body.holdings.length).toBeGreaterThan(0);
      expect(body.holdings[0]?.provenance.method).toBeTruthy();
    });
  });

  it("recommendations include range + opposing evidence", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/recommendations?limit=3`);
      const body = (await res.json()) as {
        recommendations: {
          supportingEvidence: unknown[];
          opposingEvidence: unknown[];
          marketRange: unknown;
        }[];
      };
      expect(body.recommendations[0]?.supportingEvidence.length).toBeGreaterThan(0);
      expect(body.recommendations[0]?.opposingEvidence.length).toBeGreaterThan(0);
      expect(body.recommendations[0]?.marketRange).toBeTruthy();
    });
  });

  it("hunts include Absolute Batman + Pokémon seeds", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/hunts`);
      const body = (await res.json()) as { hunts: { id: string }[] };
      const ids = body.hunts.map((h) => h.id);
      expect(ids).toContain("absolute-batman");
      expect(ids).toContain("pokemon-30th");
    });
  });
});
