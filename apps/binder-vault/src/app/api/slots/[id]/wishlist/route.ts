import { NextResponse } from "next/server";
import { setWishlistSchema } from "@/lib/contracts";
import { getBinder, setSlotWishlist } from "@/lib/repo";
import { projectSlotToVip } from "@/lib/vipWrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = setWishlistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const res = await setSlotWishlist(id, parsed.data.onWishlist);
  if (!res) {
    return NextResponse.json(
      { error: "Slot not found or empty — star filled pockets only" },
      { status: 404 },
    );
  }

  const vip = await projectSlotToVip(id);

  return NextResponse.json({
    binder: await getBinder(res.binderId),
    vipProject: vip,
  });
}
