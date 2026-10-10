import { describe, expect, it } from "vitest";
import { categoryFromFolder, planAutoIntake, type FolderScan } from "./scanAutoIntake.js";

const NOW = 1_800_000_000_000;
const file = (name: string, hash: string, ageMs = 10 * 60_000) => ({ name, hash, mtimeMs: NOW - ageMs });

describe("planAutoIntake", () => {
  it("imports a folder only when every image is new and the scanner has gone quiet", () => {
    const folders: FolderScan[] = [
      { path: "D:/VIP/scans/fi8170/Session 1", files: [file("a.jpg", "h1"), file("b.jpg", "h2")] },
      { path: "D:/VIP/scans/fi8170/Test Scans 25 Pokemon", files: [file("c.jpg", "old1"), file("d.jpg", "old2")] },
      { path: "D:/VIP/scans/fi8170/Mixed", files: [file("e.jpg", "old1"), file("f.jpg", "h3")] },
      { path: "D:/VIP/scans/fi8170/Scanning now", files: [file("g.jpg", "h4", 20_000)] },
      { path: "D:/VIP/scans/fi8170", files: [] },
    ];
    const plan = planAutoIntake(folders, new Set(["old1", "old2"]), { now: NOW });
    expect(plan.map((d) => [d.action, d.reason])).toEqual([
      ["import", "2 new images"],
      ["skip", "already imported"],
      ["skip", "1 of 2 images are already in VIP — import the new ones from /scan by hand"],
      ["skip", "still being written — waiting"],
      ["skip", "no images"],
    ]);
  });

  it("takes the category from the folder name, defaulting to sports like the Import button", () => {
    expect(categoryFromFolder("D:/VIP/scans/fi8170/Test Scans 25 Pokemon")).toBe("pokemon");
    expect(categoryFromFolder("D:/VIP/scans/fi8170/Pokémon binder 3")).toBe("pokemon");
    expect(categoryFromFolder("D:/VIP/scans/fi8170/MTG lot")).toBe("mtg");
    expect(categoryFromFolder("D:/VIP/scans/fi8170/Magic commons")).toBe("mtg");
    expect(categoryFromFolder("D:/VIP/scans/fi8170/2026-10-10 football")).toBe("sports");
  });
});
