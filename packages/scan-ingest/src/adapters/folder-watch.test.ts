import { describe, expect, it } from "vitest";
import {
  FolderWatchAdapter,
  inferFaceFromFileName,
  pairPagesIntoUnits,
} from "./folder-watch.js";

describe("FolderWatchAdapter", () => {
  it("infers front/back from PaperStream-style names", () => {
    expect(inferFaceFromFileName("scan_front.jpg")).toBe("front");
    expect(inferFaceFromFileName("scan_back.jpg")).toBe("back");
    expect(inferFaceFromFileName("scan_001.jpg")).toBe("unknown");
  });

  it("pairs sequential duplex ADF output into card units", async () => {
    const adapter = new FolderWatchAdapter({
      rootLabel: "drop",
      pairing: "sequential_duplex",
    });
    adapter.ingestDescriptors([
      { fileName: "a.jpg", bytes: "1" },
      { fileName: "b.jpg", bytes: "2" },
      { fileName: "c.jpg", bytes: "3" },
    ]);
    const pages = await adapter.listPages();
    const units = pairPagesIntoUnits(pages, "sequential_duplex", "sports");
    expect(units).toHaveLength(2);
    expect(units[0]?.front.face).toBe("front");
    expect(units[0]?.back?.face).toBe("back");
    expect(units[1]?.back).toBeUndefined();
    expect(units[0]?.categoryHint).toBe("sports");
  });
});
