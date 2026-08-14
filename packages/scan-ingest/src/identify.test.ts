import { describe, expect, it } from "vitest";
import { identifyUnit } from "./identify.js";

const FILE = "1986_topps_michael_jordan_57_front.jpg";

function confidenceFor(storageRef: string): number {
  const candidates = identifyUnit({
    ocrText: null,
    frontStorageRef: storageRef,
    categoryHint: "sports",
  });
  expect(candidates[0]?.catalogKey).toBe("sports:topps:1986:jordan:57");
  return candidates[0]!.confidence;
}

describe("identifyUnit filename fallback", () => {
  it("scores a Windows PaperStream path the same as the bare file name", () => {
    // Directory tokens (drive letter, folders) must not dilute the match ratio.
    expect(confidenceFor(`D:\\VIP\\scans\\fi8170\\${FILE}`)).toBe(confidenceFor(FILE));
  });

  it("scores a POSIX path the same as the bare file name", () => {
    expect(confidenceFor(`/srv/vip/scans/${FILE}`)).toBe(confidenceFor(FILE));
  });
});
