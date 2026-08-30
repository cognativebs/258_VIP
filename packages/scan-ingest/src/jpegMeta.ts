/** Read width/height from JPEG SOF without decoding pixels. No color changes. */

export type ImageMeta = {
  width: number | null;
  height: number | null;
  orientation: "portrait" | "landscape" | "unknown";
  format: "jpeg" | "png" | "unknown";
};

export function readImageMeta(bytes: Buffer): ImageMeta {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return {
      width,
      height,
      orientation: orientationOf(width, height),
      format: "png",
    };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { width: null, height: null, orientation: "unknown", format: "unknown" };
  }
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1]!;
    const len = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = bytes.readUInt16BE(i + 5);
      const width = bytes.readUInt16BE(i + 7);
      return {
        width,
        height,
        orientation: orientationOf(width, height),
        format: "jpeg",
      };
    }
    i += 2 + len;
  }
  return { width: null, height: null, orientation: "unknown", format: "jpeg" };
}

export function orientationOf(
  width: number | null,
  height: number | null,
): "portrait" | "landscape" | "unknown" {
  if (!width || !height) return "unknown";
  if (width === height) return "portrait";
  return width > height ? "landscape" : "portrait";
}
