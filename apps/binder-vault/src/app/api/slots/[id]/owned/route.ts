import { NextResponse } from "next/server";
import { setOwnedSchema } from "@/lib/contracts";
import { getBinder, setSlotOwned } from "@/lib/repo";
import { projectSlotToVip } from "@/lib/vipWrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = setOwnedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const res = await setSlotOwned(id, parsed.data.owned);
  if (!res) {
    return NextResponse.json(
      { error: "Slot not found or empty — mark owned on filled pockets only" },
      { status: 404 },
    );
  }

  // Binder layout is local truth for the toggle; VIP gets a durable holding.
  const vip = await projectSlotToVip(id);

  return NextResponse.json({
    binder: await getBinder(res.binderId),
    vipProject: vip,
  });
}
