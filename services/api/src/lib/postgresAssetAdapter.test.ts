import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../db/client.js";
import {
  createPostgresAssetCatalogAdapter,
  searchConfirmedAssets,
} from "./postgresAssetAdapter.js";

async function dbAvailable(): Promise<boolean> {
  try {
    await getDb().execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

afterAll(async () => {
  await closeDb();
});

describe("postgres confirmed-asset adapter", () => {
  it("returns the confirmed assetId for a re-scan name/external id", async () => {
    if (!(await dbAvailable())) {
      console.warn("skipping postgres asset adapter test: no Postgres");
      return;
    }
    const db = getDb();
    const slug = `pg-asset-${Date.now()}`;
    const created = await db.execute(sql`
      INSERT INTO vault_core.asset (category_id, canonical_name, slug, release_year)
      VALUES (1, 'Charizard', ${slug}, 1999)
      RETURNING id
    `);
    const assetId = String((created.rows as Array<Record<string, unknown>>)[0]!.id);
    await db.execute(sql`
      INSERT INTO vault_core.external_id (asset_id, source, external_value)
      VALUES (${assetId}::uuid, 'tcgdex', ${`base1-4-${slug}`})
    `);

    const byName = await searchConfirmedAssets({
      text: "Charizard Base",
      category: "pokemon",
    });
    expect(byName.some((c) => c.assetId === assetId)).toBe(true);

    const byExt = await searchConfirmedAssets({
      text: "",
      category: "pokemon",
      externalIds: [{ source: "tcgdex", value: `base1-4-${slug}` }],
    });
    expect(byExt).toHaveLength(1);
    expect(byExt[0]?.assetId).toBe(assetId);
    expect(byExt[0]?.externalIds).toContainEqual({
      source: "tcgdex",
      value: `base1-4-${slug}`,
    });

    const adapter = createPostgresAssetCatalogAdapter();
    const cards = await adapter.search({ text: "Charizard", category: "pokemon" });
    expect(cards.some((c) => c.assetId === assetId)).toBe(true);
  });
});
