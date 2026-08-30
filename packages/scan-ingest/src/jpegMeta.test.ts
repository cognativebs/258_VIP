import { describe, expect, it } from "vitest";
import { deflateSync, crc32 } from "node:zlib";
import { orientationOf, readImageMeta } from "./jpegMeta.js";

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function tinyPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("readImageMeta", () => {
  it("reads landscape vs portrait from PNG without decoding pixels", () => {
    const land = readImageMeta(tinyPng(210, 150));
    expect(land.format).toBe("png");
    expect(land.width).toBe(210);
    expect(land.height).toBe(150);
    expect(land.orientation).toBe("landscape");
    expect(orientationOf(150, 210)).toBe("portrait");
  });
});
