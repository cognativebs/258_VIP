import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHELL_REDIRECT_PAGES, activeShellRedirectPages, shellRedirects } from "./shellRedirects";

describe("shell redirects, per page (Q22)", () => {
  it("is off by default while no page is absorbed", () => {
    assert.equal(SHELL_REDIRECT_PAGES.some((p) => p.absorbed), false);
    assert.deepEqual(shellRedirects(undefined), []);
    assert.deepEqual(shellRedirects(""), []);
  });

  it("turns on only the named pages, with their sub-paths", () => {
    const r = shellRedirects("/sell-queue, ebay");
    assert.deepEqual(
      r.map((x) => x.source),
      ["/sell-queue", "/ebay", "/ebay/:path*"],
    );
    assert.ok(r.every((x) => x.permanent === false));
  });

  it("all / 1 turns on every page; off / 0 turns on none", () => {
    assert.equal(activeShellRedirectPages("all").length, SHELL_REDIRECT_PAGES.length);
    assert.equal(activeShellRedirectPages("1").length, SHELL_REDIRECT_PAGES.length);
    assert.deepEqual(activeShellRedirectPages("off"), []);
    assert.deepEqual(activeShellRedirectPages("0"), []);
  });

  it("keeps an unabsorbed page's gap written down", () => {
    for (const p of SHELL_REDIRECT_PAGES) {
      if (!p.absorbed) assert.ok(p.missing, `${p.page} should say what its concept still lacks`);
    }
  });
});
