import { delimiter, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAllowedScanPath } from "./scanMedia.js";

const before = process.env.VIP_SCAN_EXTRA_ROOTS;
afterEach(() => {
  if (before === undefined) delete process.env.VIP_SCAN_EXTRA_ROOTS;
  else process.env.VIP_SCAN_EXTRA_ROOTS = before;
});

describe("scan media allow-list", () => {
  it("serves masters from a configured extra root, and still nothing outside the roots", () => {
    const other = resolve("/elsewhere/258_VIP/data/scan-masters");
    const second = resolve("/second/masters");
    const file = join(other, "batch", "abc_0001.jpg");
    delete process.env.VIP_SCAN_EXTRA_ROOTS;
    expect(isAllowedScanPath(file)).toBe(false);
    process.env.VIP_SCAN_EXTRA_ROOTS = [other, second].join(delimiter);
    expect(isAllowedScanPath(file)).toBe(true);
    expect(isAllowedScanPath(join(second, "x.jpg"))).toBe(true);
    expect(isAllowedScanPath(resolve("/elsewhere/258_VIP/secrets.txt"))).toBe(false);
    expect(isAllowedScanPath(join(other, "..", "..", "..", "etc", "passwd"))).toBe(false);
    expect(isAllowedScanPath("relative/abc.jpg")).toBe(false);
  });
});
