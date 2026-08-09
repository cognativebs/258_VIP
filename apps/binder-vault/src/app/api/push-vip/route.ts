import { NextResponse } from "next/server";
import { z } from "zod";
import { projectBinderToVip } from "@/lib/vipWrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  binderId: z.string().min(1).optional(),
});

/** Bulk Binder → VIP: project all filled slots' owned/wishlist into durable VIP rows. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await projectBinderToVip(parsed.data.binderId);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        hint: "Start VIP API (npm run api) — use LAN IP when on phone",
      },
      { status: 502 },
    );
  }
  return NextResponse.json(result);
}
