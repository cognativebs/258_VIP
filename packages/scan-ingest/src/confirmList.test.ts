import { describe, expect, it } from "vitest";
import {
  formatDuplicateCopyVerifyMessage,
  unitNeedsInventoryCopyAck,
} from "./confirmListCopy.js";
import {
  ApproveConfirmListConflictSchema,
  ApproveConfirmListRequestSchema,
  ConfirmListRequestSchema,
} from "./schemas.js";

describe("confirm list contracts", () => {
  it("accepts onList true/false", () => {
    expect(ConfirmListRequestSchema.parse({ onList: true }).onList).toBe(true);
    expect(ConfirmListRequestSchema.parse({ onList: false }).onList).toBe(false);
    expect(ConfirmListRequestSchema.safeParse({}).success).toBe(false);
  });

  it("treats approve body as optional acknowledge flag", () => {
    expect(ApproveConfirmListRequestSchema.parse({}).acknowledgeDuplicates).toBe(
      undefined,
    );
    expect(
      ApproveConfirmListRequestSchema.parse({ acknowledgeDuplicates: true })
        .acknowledgeDuplicates,
    ).toBe(true);
  });

  it("flags already-held or reimported cards as needing a copy ack", () => {
    expect(unitNeedsInventoryCopyAck({})).toBe(false);
    expect(unitNeedsInventoryCopyAck({ duplicateAcknowledged: true })).toBe(
      true,
    );
    expect(unitNeedsInventoryCopyAck({ physicalReimport: true })).toBe(true);
  });

  it("names the already-held card in the verify message", () => {
    expect(formatDuplicateCopyVerifyMessage(["Carvanha (ME02 060)"])).toBe(
      "This card already exists in inventory:\n\nCarvanha (ME02 060)\n\nAdd another copy?",
    );
    expect(
      formatDuplicateCopyVerifyMessage(["Carvanha (ME02 060)", "Seel (ME02 023)"]),
    ).toMatch(/Add another copy of each\?/);
  });

  it("parses an approve conflict listing the already-held cards", () => {
    const parsed = ApproveConfirmListConflictSchema.parse({
      ok: false,
      error: "already held",
      code: "DUPLICATE_UNACKNOWLEDGED",
      duplicates: [
        {
          unitId: "11111111-1111-1111-1111-111111111111",
          displayName: "Carvanha (ME02 060)",
        },
      ],
    });
    expect(parsed.duplicates[0]?.displayName).toMatch(/Carvanha/);
  });
});
