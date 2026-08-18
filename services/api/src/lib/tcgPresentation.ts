/**
 * Display-time TCG name + art. Never invents a printed name.
 * Art URL from Binder / asset / official Pokémon TCG CDN for a known id —
 * not stored as a verified grade or price.
 */

export type TcgExternalId = { source: string; externalValue: string };

/** Official pokemontcg.io image layout for id `{set}-{number}` (e.g. base1-4). */
export function pokemontcgImageUrl(externalValue: string): string | null {
  const raw = externalValue.trim();
  const dash = raw.indexOf("-");
  if (dash <= 0 || dash === raw.length - 1) return null;
  const set = raw.slice(0, dash).toLowerCase();
  const num = raw.slice(dash + 1);
  if (!/^[a-z0-9]+$/i.test(set)) return null;
  return `https://images.pokemontcg.io/${set}/${encodeURIComponent(num)}.png`;
}

export function binderMediaUrl(imageLocal: string, binderPublicUrl: string): string | null {
  const name = imageLocal.trim().replace(/^\/+/, "");
  if (!name) return null;
  const base = binderPublicUrl.replace(/\/$/, "") || "http://127.0.0.1:3010";
  return `${base}/api/media/${encodeURIComponent(name)}`;
}

export function resolveTcgCover(opts: {
  coverImageUrl?: string | null;
  primaryImageUrl?: string | null;
  imageLocal?: string | null;
  binderPublicUrl?: string | null;
  externalIds?: TcgExternalId[] | null;
}): string | null {
  const direct = opts.coverImageUrl?.trim();
  if (direct) return direct;
  const primary = opts.primaryImageUrl?.trim();
  if (primary) return primary;
  if (opts.imageLocal && opts.binderPublicUrl) {
    const local = binderMediaUrl(opts.imageLocal, opts.binderPublicUrl);
    if (local) return local;
  }
  const tcg = opts.externalIds?.find((e) => e.source.toLowerCase() === "pokemontcg");
  if (tcg?.externalValue) return pokemontcgImageUrl(tcg.externalValue);
  return null;
}

function isPrintedCardName(value: string, set: string): boolean {
  const v = value.trim();
  if (!v) return false;
  const lower = v.toLowerCase();
  if (lower === "unnamed card" || lower.endsWith(" unnamed card")) return false;
  if (lower === "unknown set") return false;
  if (set && lower === set.trim().toLowerCase()) return false;
  return true;
}

export function printedTcgName(opts: {
  cardName?: string | null;
  assetName?: string | null;
  series?: string | null;
  issue?: string | null;
}): string | null {
  const set = (opts.series ?? "").trim();
  const num = (opts.issue ?? "").trim();
  const named = opts.cardName?.trim() ?? "";
  if (isPrintedCardName(named, set)) return named;

  const asset = (opts.assetName ?? "").trim();
  if (num) {
    const needle = `#${num} `;
    const idx = asset.toLowerCase().indexOf(needle.toLowerCase());
    if (idx >= 0) {
      const rest = asset.slice(idx + needle.length).trim();
      if (isPrintedCardName(rest, set)) return rest;
    }
  }
  if (isPrintedCardName(asset, set)) return asset;
  return null;
}

export function binderPublicUrl(): string {
  return (
    process.env.BINDER_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_BINDER_URL ||
    "http://127.0.0.1:3010"
  ).replace(/\/$/, "");
}
