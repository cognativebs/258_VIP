import { NextResponse } from "next/server";
import { updatePageSchema } from "@/lib/contracts";
import { deletePage, getBinder, updatePage } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updatePageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const res = await updatePage(id, parsed.data);
  if (!res) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ binder: await getBinder(res.binderId) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await deletePage(id);
  if (!res) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ binder: await getBinder(res.binderId) });
}
