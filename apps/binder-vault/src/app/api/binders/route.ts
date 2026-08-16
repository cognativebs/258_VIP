import { NextResponse } from "next/server";
import { createBinderSchema } from "@/lib/contracts";
import { createBinder, listBinders } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ binders: await listBinders() });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ binders: [], error }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = createBinderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const binder = await createBinder(parsed.data);
  return NextResponse.json({ binder }, { status: 201 });
}
