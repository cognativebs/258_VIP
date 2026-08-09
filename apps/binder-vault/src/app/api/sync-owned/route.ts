import { NextResponse } from "next/server";
import { syncOwnedSchema } from "@/lib/contracts";
import { syncOwnedFromExternalIds } from "@/lib/repo";

const VIP_API = process.env.VIP_API_URL ?? "http://127.0.0.1:8787";

type VipHolding = {
  id?: string;
  pillar?: string | null;
  externalIds?: { source: string; externalValue: string }[];
};

/** Owned VIP rows only — Binder "need" pockets must not flip Sync Owned. */
function isOwnedHolding(h: VipHolding): boolean {
  if (h.pillar === "TCG Need (Binder)") return false;
  if (h.pillar === "TCG Owned (Binder)") return true;
  // Comics seeds + Pokémon seed sample = owned inventory samples.
  return true;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = syncOwnedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let inventory: { holdings?: VipHolding[]; tcgSource?: string };
  try {
    const res = await fetch(`${VIP_API}/api/inventory`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `VIP inventory failed: ${res.status}` },
        { status: 502 },
      );
    }
    inventory = (await res.json()) as { holdings?: VipHolding[]; tcgSource?: string };
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "VIP API unreachable",
        hint: `Start VIP API (${VIP_API}) with npm run api — use LAN IP when on phone`,
      },
      { status: 502 },
    );
  }

  const matches = (inventory.holdings ?? [])
    .filter(isOwnedHolding)
    .flatMap((h) => h.externalIds ?? []);
  const result = await syncOwnedFromExternalIds(matches, {
    binderId: parsed.data.binderId,
  });

  return NextResponse.json({
    ok: true,
    matched: result.matched,
    markedOwned: result.markedOwned,
    alreadyOwned: result.alreadyOwned,
    vipExternalIds: matches.length,
    slotsChecked: result.slotsChecked,
    tcgSource: inventory.tcgSource ?? null,
    binder: result.binder,
    provenance: {
      method: "api" as const,
      source: "vip-api",
      modelVersion: "vip-owned-sync@0.2.0",
      confidence: 0.7,
      verificationStatus: "unverified" as const,
    },
  });
}
