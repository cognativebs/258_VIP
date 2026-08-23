import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capAttachments, parseRefPaths } from "./operatorAttachments";

describe("operatorAttachments", () => {
  it("rejects parent, absolute, and binary paths", () => {
    assert.deepEqual(parseRefPaths("../secret.md\n/etc/passwd.md\ndocs/ok.md\nphoto.png"), [
      "docs/ok.md",
    ]);
  });

  it("caps count and total characters", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `${i}.md`,
      text: "hello",
      source: "upload" as const,
    }));
    assert.equal(capAttachments(many).length, 8);
    const huge = capAttachments([{ name: "big.md", text: "x".repeat(90_000), source: "paste" }]);
    assert.ok((huge[0]?.text.length || 0) <= 24_000);
  });
});
