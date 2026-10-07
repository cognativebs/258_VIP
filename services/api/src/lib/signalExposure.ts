/**
 * Your exposure to a synthesized Pokémon signal: Binder slots you own or
 * wishlist for its set, card or Pokémon, and hunts that name it (operator
 * decision 2026-10-04: Binder + hunts). Matching uses the same normalized keys
 * as entity extraction; nothing is guessed beyond that.
 */
import { SPECIES_BY_DEX } from "@vip/core-model";
import { entityKey, type SignalExposure } from "@vip/signals";
import type { Hunt } from "../seeds/hunts.js";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export type BinderSlot = { setName: string | null; cardName: string | null; owned: boolean; wishlist: boolean; externalId?: string | null };
export type HuntText = { hunt: string; text: string };

/** "pokemon:dex:151" → pokemon/mew; "binder_set:x", "set:x", "card:x", "product:x" → that kind and key. */
export function parseEntityRef(ref: string | null): { kind: string; key: string } | null {
  if (!ref) return null;
  const dex = /^pokemon:dex:(\d+)$/.exec(ref);
  if (dex) {
    const name = SPECIES_BY_DEX[Number(dex[1])];
    return name ? { kind: "pokemon", key: entityKey(name) } : null;
  }
  const m = /^(binder_set|vault_pokemon\.set|binder_card|set|card|product|pokemon):(.+)$/.exec(ref);
  if (!m) return null;
  const kind = m[1] === "binder_set" || m[1] === "vault_pokemon.set" ? "set" : m[1] === "binder_card" ? "card" : m[1]!;
  return { kind, key: m[1] === "vault_pokemon.set" ? m[2]! : entityKey(m[2]!) };
}

const hasTokens = (haystackKey: string, needleKey: string) => `-${haystackKey}-`.includes(`-${needleKey}-`);

export function exposureFor(ref: string | null, binder: ReadonlyArray<BinderSlot>, hunts: ReadonlyArray<HuntText>): SignalExposure {
  const parsed = parseEntityRef(ref);
  const empty: SignalExposure = { owned: 0, wishlist: 0, hunts: [], matched: [] };
  if (!parsed) return empty;
  const matches = binder.filter((s) => {
    const set = s.setName ? entityKey(s.setName) : "";
    const card = s.cardName ? entityKey(s.cardName) : "";
    if (parsed.kind === "set") return set === parsed.key;
    if (parsed.kind === "card") return card === parsed.key;
    if (parsed.kind === "pokemon") return hasTokens(card, parsed.key);
    return false;
  });
  const huntHits = [...new Set(hunts.filter((h) => hasTokens(entityKey(h.text), parsed.key)).map((h) => h.hunt))];
  const matched = [
    ...new Set(matches.map((s) => [s.cardName, s.setName].filter(Boolean).join(" · ")).filter(Boolean)),
  ];
  const cardIds = [
    ...new Set(matches.filter((s) => s.owned || s.wishlist).map((s) => s.externalId).filter((x): x is string => Boolean(x))),
  ];
  return {
    owned: matches.filter((s) => s.owned).length,
    wishlist: matches.filter((s) => s.wishlist && !s.owned).length,
    hunts: huntHits,
    matched,
    cardIds,
  };
}

export async function loadBinderSlots(db: Queryable): Promise<BinderSlot[]> {
  const { rows } = await db.query(`SELECT set_name, card_name, owned, on_wishlist, external_id FROM vault_tcg.binder_slot`);
  return rows.map((r) => ({
    setName: r.set_name,
    cardName: r.card_name,
    owned: Boolean(r.owned),
    wishlist: Boolean(r.on_wishlist),
    externalId: r.external_id ?? null,
  }));
}

/** Pokémon hunts as searchable text: the hunt's name plus each item's name. */
export function huntTexts(hunts: ReadonlyArray<Hunt>): HuntText[] {
  return hunts
    .filter((h) => h.category === "pokemon")
    .flatMap((h) => [{ hunt: h.name, text: h.name }, ...h.sections.flatMap((s) => s.items.map((i) => ({ hunt: h.name, text: i.name })))]);
}
