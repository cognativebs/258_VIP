import { NextResponse } from "next/server";
import { z } from "zod";
import { probeVipApi, projectBinderToVip, VIP_API } from "@/lib/vipWrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  binderId: z.string().min(1).optional(),
});

/** Diagnose why Push to VIP 502s without writing anything. */
export async function GET() {
  const probe = await probeVipApi();
  return NextResponse.json({ vipApi: VIP_API, ...probe }, { status: probe.ok ? 200 : 502 });
}

/** Bulk Binder → VIP: project all filled slots' owned/wishlist into durable VIP rows. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await projectBinderToVip(parsed.data.binderId);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        hint: result.hint ?? `Start VIP API: npm run api (expected ${VIP_API})`,
      },
      { status: 502 },
    );
  }
  return NextResponse.json(result);
}
