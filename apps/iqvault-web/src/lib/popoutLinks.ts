import { z } from "zod";

/** Binder Vault (pocket editor). Same default as the desktop stack on :3010. */
export const BINDER_URL = process.env.NEXT_PUBLIC_BINDER_URL ?? "http://localhost:3010";

/** Orchestr8 Console (team / specs / runs). Same default as `npm run orchestr8:console`. */
export const ORCHESTR8_CONSOLE_URL =
  process.env.NEXT_PUBLIC_ORCHESTR8_CONSOLE_URL ?? "http://localhost:3001";

export const popoutLinkSchema = z.object({
  id: z.enum(["binder", "orchestr8"]),
  label: z.string().min(1),
  href: z.string().url(),
  title: z.string().min(1),
});

export type PopoutLink = z.infer<typeof popoutLinkSchema>;

const POPOUTS: PopoutLink[] = [
  { id: "binder", label: "Binder", href: BINDER_URL, title: "Open Binder Vault" },
  { id: "orchestr8", label: "Orchestr8", href: ORCHESTR8_CONSOLE_URL, title: "Open Orchestr8 Console" },
];

/** Header pop-outs — companion apps, new window, not a second IQVault tab. */
export function popoutLinks(): PopoutLink[] {
  return POPOUTS.map((link) => popoutLinkSchema.parse(link));
}
