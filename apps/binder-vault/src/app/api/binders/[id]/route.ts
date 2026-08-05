import { NextResponse } from "next/server";
import { updateBinderSchema } from "@/lib/contracts";
import { deleteBinder, getBinder, updateBinder } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const binder = await getBinder(id);
  if (!binder) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ binder });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateBinderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const binder = await updateBinder(id, parsed.data);
  if (!binder) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ binder });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = await deleteBinder(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
