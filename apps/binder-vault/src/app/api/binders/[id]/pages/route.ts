import { NextResponse } from "next/server";
import { reorderPagesSchema } from "@/lib/contracts";
import { addPage, reorderPages } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const binder = await addPage(id);
  if (!binder) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ binder }, { status: 201 });
}

/** Reorder pages: body `{ pageIds: string[] }` — full ordered list. */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = reorderPagesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const binder = await reorderPages(id, parsed.data.pageIds);
  if (!binder) {
    return NextResponse.json(
      { error: "invalid page order — ids must match this binder's pages exactly" },
      { status: 400 },
    );
  }
  return NextResponse.json({ binder });
}
