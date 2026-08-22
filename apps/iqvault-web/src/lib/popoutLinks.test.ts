import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ORCHESTR8_CONSOLE_URL, popoutLinkSchema, popoutLinks } from "./popoutLinks";

describe("popoutLinks", () => {
  it("exposes Binder and Orchestr8 as new-window companions", () => {
    const links = popoutLinks();
    assert.deepEqual(
      links.map((l) => l.id),
      ["binder", "orchestr8"],
    );
    const binder = links.find((l) => l.id === "binder");
    const orchestr8 = links.find((l) => l.id === "orchestr8");
    assert.equal(binder?.label, "Binder");
    assert.match(binder?.href ?? "", /:3010$/);
    assert.equal(orchestr8?.label, "Orchestr8");
    assert.equal(orchestr8?.href, ORCHESTR8_CONSOLE_URL);
    assert.match(orchestr8?.href ?? "", /:3001$/);
  });

  it("rejects a pop-out without a real URL", () => {
    const parsed = popoutLinkSchema.safeParse({
      id: "orchestr8",
      label: "Orchestr8",
      href: "not-a-url",
      title: "Open Orchestr8 Console",
    });
    assert.equal(parsed.success, false);
  });
});
