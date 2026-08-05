import { NextResponse } from "next/server";
import { slotWriteSchema } from "@/lib/contracts";
import { clearSlot, getBinder, writeSlot } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = slotWriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const res = await writeSlot(id, parsed.data);
  if (!res) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ binder: await getBinder(res.binderId) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await clearSlot(id);
  if (!res) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ binder: await getBinder(res.binderId) });
}
