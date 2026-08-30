import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";

/**
 * 20 physical cards / 40 front-back images for Ricoh intake acceptance.
 * Bytes are unique per file (except the intentional physical reimport).
 * Identity comes from PaperStream-style filenames + optional OCR sidecars.
 */
export type RicohFixtureCard = {
  stem: string;
  kind: string;
  landscape?: boolean;
  /** Same pixels as this earlier stem (physical reimport). */
  reimportOf?: string;
  /** Sidecar OCR when the filename must stay pairable. */
  frontOcr?: string;
  backOcr?: string;
};

export const RICOH_V1_ROSTER: RicohFixtureCard[] = [
  { stem: "01_1986_topps_michael_jordan_57_rookie", kind: "older paper / rookie" },
  { stem: "02_2023_prizm_victor_wembanyama_136", kind: "chrome / Prizm / dark" },
  { stem: "03_2024_topps_shohei_ohtani_1", kind: "white design" },
  { stem: "04_2020_panini_contenders_justin_herbert_101", kind: "landscape", landscape: true },
  { stem: "05_2025_prizm_kurtis_rourke_397_silver", kind: "chrome / parallel" },
  { stem: "06_2023_topps_chrome_elly_de_la_cruz_88", kind: "foil / refractor" },
  { stem: "07_2023_prizm_downtown_patrick_mahomes_1", kind: "insert" },
  { stem: "08_2023_select_cj_stroud_43_rookie", kind: "rookie" },
  { stem: "09_2025_donruss_jayden_daniels_12", kind: "newer set" },
  { stem: "10_2024_prizm_caleb_williams_301_numbered_25", kind: "serial / numbered" },
  { stem: "11_2023_select_cj_stroud_43_auto_relic", kind: "autograph / relic" },
  { stem: "12_1999_pokemon_charizard_4", kind: "TCG" },
  { stem: "13_1993_upper_deck_derek_jeter_449", kind: "older baseball" },
  { stem: "14_2023_prizm_victor_wembanyama_136_gold", kind: "parallel gold" },
  { stem: "15_1989_upper_deck_ken_griffey_jr_1", kind: "older set" },
  { stem: "16_2024_prizm_bo_nix_331", kind: "dark chrome" },
  { stem: "17_2018_panini_contenders_lamar_jackson_1", kind: "landscape insert", landscape: true },
  { stem: "18_2024_mosaic_drake_maye_318_rookie", kind: "newer rookie" },
  {
    stem: "19_reimport_1986_topps_michael_jordan_57_rookie",
    kind: "physical reimport",
    reimportOf: "01_1986_topps_michael_jordan_57_rookie",
  },
  {
    stem: "20_conflict",
    kind: "front/back identity conflict",
    frontOcr: "1986 Topps Michael Jordan 57",
    backOcr: "1993 Upper Deck Derek Jeter 449",
  },
];

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAf/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAF/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwD/2Q==",
  "base64",
);

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** Minimal RGB PNG. Unique tEXt so content_hash does not collide. */
export function makeScanPng(width: number, height: number, unique: string): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const text = Buffer.concat([Buffer.from("Comment\0"), Buffer.from(unique)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", text),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Valid JPEG + unique trailer. No color/foil enhancement. */
export function makeScanJpeg(unique: string): Buffer {
  return Buffer.concat([TINY_JPEG, Buffer.from(`\n${unique}\n`, "utf8")]);
}

export function writeRicohV1Fixture(
  dir: string,
  salt = "",
): { dir: string; imageCount: number } {
  mkdirSync(dir, { recursive: true });
  const byStem = new Map<string, { front: Buffer; back: Buffer; ext: string }>();
  let imageCount = 0;

  for (const card of RICOH_V1_ROSTER) {
    const ext = card.landscape ? "png" : "jpg";
    let front: Buffer;
    let back: Buffer;
    if (card.reimportOf) {
      const src = byStem.get(card.reimportOf);
      if (!src) throw new Error(`reimportOf ${card.reimportOf} not written yet`);
      front = src.front;
      back = src.back;
    } else if (card.landscape) {
      front = makeScanPng(210, 150, `${salt}${card.stem}_front`);
      back = makeScanPng(210, 150, `${salt}${card.stem}_back`);
    } else {
      front = makeScanJpeg(`${salt}${card.stem}_front`);
      back = makeScanJpeg(`${salt}${card.stem}_back`);
    }
    byStem.set(card.stem, { front, back, ext });
    writeFileSync(join(dir, `${card.stem}_front.${ext}`), front);
    writeFileSync(join(dir, `${card.stem}_back.${ext}`), back);
    imageCount += 2;
    if (card.frontOcr) writeFileSync(join(dir, `${card.stem}_front.txt`), card.frontOcr);
    if (card.backOcr) writeFileSync(join(dir, `${card.stem}_back.txt`), card.backOcr);
  }

  writeFileSync(
    join(dir, "README.md"),
    [
      "# Ricoh fi-8170 intake fixture (20 cards / 40 images)",
      "",
      "Placeholder duplex files with PaperStream-style `*_front` / `*_back` names.",
      "Replace a pair with real 600 DPI scans of the same stem and re-import.",
      "",
      "Card 19 is a byte-identical reimport of card 1.",
      "Card 20 has conflicting front/back OCR sidecars (Jordan vs Jeter).",
      "",
    ].join("\n"),
  );

  return { dir, imageCount };
}
