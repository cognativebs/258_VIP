/**
 * Binder → VIP write bridge.
 *
 * After a local owned/wishlist toggle, notify the VIP API so it can upsert
 * durable holdings / watchlist rows. Failures are returned (not thrown) so a
 * down VIP API never blocks Binder layout edits.
 */

const VIP_API = process.env.VIP_API_URL ?? "http://127.0.0.1:8787";

export type VipProjectResult = {
  ok: boolean;
  slotId?: string;
  holding?: string;
  watchlist?: string;
  error?: string;
  ruleOrModelVersion?: string;
};

export async function projectSlotToVip(slotId: string): Promise<VipProjectResult> {
  try {
    const res = await fetch(
      `${VIP_API}/api/tcg/slots/${encodeURIComponent(slotId)}/project`,
      { method: "POST", cache: "no-store" },
    );
    const body = (await res.json().catch(() => ({}))) as VipProjectResult;
    if (!res.ok) {
      return {
        ok: false,
        error: body.error ?? `VIP project failed: ${res.status}`,
      };
    }
    return body;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "VIP API unreachable",
    };
  }
}

export async function projectBinderToVip(binderId?: string): Promise<{
  ok: boolean;
  slots?: number;
  holdingsUpserted?: number;
  holdingsDeleted?: number;
  watchlistUpserted?: number;
  watchlistDeleted?: number;
  error?: string;
}> {
  try {
    const res = await fetch(`${VIP_API}/api/tcg/project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(binderId ? { binderId } : {}),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      slots?: number;
      holdingsUpserted?: number;
      holdingsDeleted?: number;
      watchlistUpserted?: number;
      watchlistDeleted?: number;
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, error: body.error ?? `VIP project failed: ${res.status}` };
    }
    return { ok: true, ...body };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "VIP API unreachable",
    };
  }
}
