import { describe, expect, it } from "vitest";
import {
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
});
