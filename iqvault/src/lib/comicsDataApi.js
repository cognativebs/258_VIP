/** Fetch comics data from PostgreSQL via the Comics API. */

export async function fetchComicsMeta() {
  const res = await fetch("/api/comics/meta");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Comics API meta failed (${res.status})`);
  }
  return res.json();
}

export async function fetchComicsInventory() {
  const res = await fetch("/api/comics/inventory");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Comics API inventory failed (${res.status})`);
  }
  return res.json();
}

export async function fetchComicsHealth() {
  const res = await fetch("/api/comics/health");
  return res.json().catch(() => ({ ok: false }));
}

/** Patch one holding — fields use CLZ/inventory keys (Collection Pillar, etc.). */
export async function patchComicHolding(id, fields) {
  const res = await fetch(`/api/comics/holding/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Save failed (${res.status})`);
  }
  return data.row;
}
