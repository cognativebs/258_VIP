import { NextResponse } from "next/server";
import { transferPageSchema } from "@/lib/contracts";
import { transferPage } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = transferPageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await transferPage(id, parsed.data.targetBinderId, parsed.data.mode);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    sourceBinder: result.sourceBinder,
    targetBinder: result.targetBinder,
    newPageId: result.newPageId,
    mode: result.mode,
    gridMismatch: result.gridMismatch,
    droppedCards: result.droppedCards,
  });
}
