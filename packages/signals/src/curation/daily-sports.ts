/**
 * Daily Sports SIGNAL curation (pure). The profile's shares decide how many
 * slots each sport group gets; within a group, signals rank by decayed
 * influence. Shares never touch a signal's stored scores or its priority.
 * Groups with stance "exit" are sports the collector is selling out of: their
 * up-direction signals are framed as sell windows. That is framing, not a
 * Sell recommendation — nothing here is linked to holdings yet.
 */
import { z } from "zod";

const KeySchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const CurationStanceSchema = z.enum(["collect", "exit"]);
export type CurationStance = z.infer<typeof CurationStanceSchema>;

export const DailySportsProfileSchema = z
  .object({
    schema: z.literal("vip_signals_curation_v1"),
    name: z.literal("daily-sports"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    domain: z.literal("sports_cards"),
    slots: z.number().int().positive().max(200),
    windowHours: z.number().int().positive().max(24 * 14),
    groups: z
      .array(
        z
          .object({
            key: KeySchema,
            label: z.string().min(1),
            share: z.number().gt(0).max(1),
            /** ESPN feed sport keys (the path segment in /espn/rss/<sport>/news). */
            sports: z.array(KeySchema).min(1),
            stance: CurationStanceSchema,
          })
          .strict(),
      )
      .min(1),
    /** Slots a group cannot fill go to other groups' next-best signals, in this group order. */
    backfillOrder: z.array(KeySchema),
    notes: z.string().min(1),
  })
  .strict()
  .superRefine((p, ctx) => {
    const total = p.groups.reduce((sum, g) => sum + g.share, 0);
    if (Math.abs(total - 1) > 1e-9) {
      ctx.addIssue({ code: "custom", path: ["groups"], message: `shares sum to ${total}, not 1` });
    }
    const keys = new Set(p.groups.map((g) => g.key));
    const sports = new Set<string>();
    p.groups.forEach((g, i) =>
      g.sports.forEach((s) => {
        if (sports.has(s)) ctx.addIssue({ code: "custom", path: ["groups", i, "sports"], message: `${s} is in two groups` });
        sports.add(s);
      }),
    );
    p.backfillOrder.forEach((k, i) => {
      if (!keys.has(k)) ctx.addIssue({ code: "custom", path: ["backfillOrder", i], message: `unknown group ${k}` });
    });
  });
export type DailySportsProfile = z.infer<typeof DailySportsProfileSchema>;

export type CurationCandidate = {
  signalId: string;
  sport: string;
  direction: string;
  /** signal_influence at the curation time: read-time priority after decay. */
  influence: number;
};

export type CuratedItem<C extends CurationCandidate> = C & {
  rank: number;
  group: string;
  stance: CurationStance;
  framing: "sell_window" | "exit_watch" | null;
  backfilled: boolean;
};

/** "https://www.espn.com/espn/rss/nfl/news" → "nfl". */
export function sportFromFeedUrl(url: string | null | undefined): string | null {
  return /\/rss\/([a-z0-9_]+)\/news\b/i.exec(url ?? "")?.[1]?.toLowerCase() ?? null;
}

/** Largest-remainder allocation of slots by share; ties go to the earlier group. */
export function allocateSlots(profile: DailySportsProfile): Map<string, number> {
  const raw = profile.groups.map((g, i) => ({ key: g.key, i, exact: g.share * profile.slots }));
  const out = new Map(raw.map((r) => [r.key, Math.floor(r.exact + 1e-9)]));
  let left = profile.slots - [...out.values()].reduce((a, b) => a + b, 0);
  const byRemainder = [...raw].sort((a, b) => b.exact - Math.floor(b.exact + 1e-9) - (a.exact - Math.floor(a.exact + 1e-9)) || a.i - b.i);
  for (const r of byRemainder) {
    if (left <= 0) break;
    out.set(r.key, out.get(r.key)! + 1);
    left -= 1;
  }
  return out;
}

export function curateDailySports<C extends CurationCandidate>(candidates: ReadonlyArray<C>, rawProfile: unknown) {
  const profile = DailySportsProfileSchema.parse(rawProfile);
  const allocation = allocateSlots(profile);
  const groupOf = new Map<string, DailySportsProfile["groups"][number]>();
  for (const g of profile.groups) for (const s of g.sports) groupOf.set(s, g);

  const byGroup = new Map<string, C[]>(profile.groups.map((g) => [g.key, []]));
  let outsideProfile = 0;
  for (const c of candidates) {
    const g = groupOf.get(c.sport);
    if (!g) {
      outsideProfile += 1;
      continue;
    }
    byGroup.get(g.key)!.push(c);
  }
  for (const list of byGroup.values()) list.sort((a, b) => b.influence - a.influence || a.signalId.localeCompare(b.signalId));

  const picked: { c: C; group: DailySportsProfile["groups"][number]; backfilled: boolean }[] = [];
  const cursor = new Map(profile.groups.map((g) => [g.key, 0]));
  let open = 0;
  for (const g of profile.groups) {
    const list = byGroup.get(g.key)!;
    const n = Math.min(allocation.get(g.key)!, list.length);
    for (let i = 0; i < n; i += 1) picked.push({ c: list[i]!, group: g, backfilled: false });
    cursor.set(g.key, n);
    open += allocation.get(g.key)! - n;
  }
  for (const key of profile.backfillOrder) {
    const g = profile.groups.find((x) => x.key === key)!;
    const list = byGroup.get(key)!;
    while (open > 0 && cursor.get(key)! < list.length) {
      picked.push({ c: list[cursor.get(key)!]!, group: g, backfilled: true });
      cursor.set(key, cursor.get(key)! + 1);
      open -= 1;
    }
  }

  picked.sort((a, b) => b.c.influence - a.c.influence || a.c.signalId.localeCompare(b.c.signalId));
  const items: CuratedItem<C>[] = picked.map(({ c, group, backfilled }, i) => ({
    ...c,
    rank: i + 1,
    group: group.key,
    stance: group.stance,
    framing: group.stance === "exit" ? (c.direction === "up" ? "sell_window" : "exit_watch") : null,
    backfilled,
  }));

  return {
    profile: { name: profile.name, version: profile.version, slots: profile.slots, windowHours: profile.windowHours },
    groups: profile.groups.map((g) => ({
      key: g.key,
      label: g.label,
      share: g.share,
      stance: g.stance,
      allocated: allocation.get(g.key)!,
      candidates: byGroup.get(g.key)!.length,
      filled: items.filter((i) => i.group === g.key && !i.backfilled).length,
      backfilled: items.filter((i) => i.group === g.key && i.backfilled).length,
    })),
    unfilled: open,
    outsideProfile,
    items,
  };
}
