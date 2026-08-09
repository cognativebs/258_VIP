import { describe, expect, it } from "vitest";
import {
  comicHoldingFieldsSchema,
  comicHoldingPatchBodySchema,
  comicRowFromDb,
} from "./comicsWrite.js";

describe("comicsWrite schemas", () => {
  it("accepts Mark verified style patch", () => {
    const parsed = comicHoldingFieldsSchema.safeParse({ "Needs Verification": "No" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data["Needs Verification"]).toBe("No");
    }
  });

  it("accepts { fields: ... } envelope used by Comics Terminal", () => {
    const parsed = comicHoldingPatchBodySchema.safeParse({
      fields: { "Needs Verification": "No", "Verification Notes": "Checked" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown CLZ keys (no silent ignore of typos)", () => {
    const parsed = comicHoldingFieldsSchema.safeParse({ NotAField: "x" });
    expect(parsed.success).toBe(false);
  });
});

describe("comicRowFromDb", () => {
  it("overlays live columns onto clz_metadata and keeps source_row_id as id", () => {
    const row = comicRowFromDb({
      source_row_id: "clz-abc",
      series_title: "X-Men",
      issue_number: "1",
      publisher: "Marvel",
      cover_label: "A",
      primary_image_url: "https://example.com/c.jpg",
      collection_pillar: "Keys",
      recommendation: "Hold",
      sell_priority: "Low",
      museum_score: 80,
      investment_score: 70,
      liquidity_score: 60,
      upgrade_candidate: false,
      needs_grading: false,
      needs_photo: false,
      needs_verification: false,
      verification_notes: "Checked",
      value_locked: false,
      quantity: 1,
      location: "Bin A",
      current_price_snapshot: 25,
      purchase_price: 10,
      slab_status: "Raw",
      assumed_grade: "NM assumed",
      grade_rating: 0,
      clz_metadata: { Series: "Old", "Is Key Comic": "Minor" },
      is_key_issue: true,
      key_reason: "First",
    });

    expect(row.id).toBe("clz-abc");
    expect(row.Series).toBe("X-Men");
    expect(row["Needs Verification"]).toBe("No");
    expect(row["Verification Notes"]).toBe("Checked");
    expect(row["Is Key Comic"]).toBe("Minor");
    expect(row._source).toBe("postgres");
  });
});
