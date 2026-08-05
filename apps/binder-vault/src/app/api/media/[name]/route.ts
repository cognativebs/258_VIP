import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { MEDIA_DIR } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

type Ctx = { params: Promise<{ name: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { name } = await params;
  const safe = basename(name); // prevent path traversal
  const ext = extname(safe).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const data = await readFile(join(MEDIA_DIR, safe));
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
