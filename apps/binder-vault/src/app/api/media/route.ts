import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { MEDIA_DIR } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MAX_BYTES = 15 * 1024 * 1024; // 15MB

function uid(): string {
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

/** Cache an uploaded image on disk; return the local filename (stored in DB). */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }
  const ext = (extname(file.name) || ".png").toLowerCase();
  if (!ALLOWED.has(ext)) {
    return NextResponse.json({ error: "unsupported type" }, { status: 415 });
  }
  const name = `${uid()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(MEDIA_DIR, name), buffer);
  return NextResponse.json({ imageLocal: name }, { status: 201 });
}
