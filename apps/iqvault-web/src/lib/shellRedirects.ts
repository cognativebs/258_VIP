/**
 * Old page → concept redirects (ADR 0014; finish plan Q22, owner 2026-11-23:
 * "turn it on per page as each concept absorbs its page").
 *
 * Each old page keeps working by URL until its concept really does its job.
 * When that happens, set `absorbed: true` on that page here (a reviewed code
 * change) and the redirect goes live. The operator can also try pages early
 * without a code change:
 *
 *   VIP_SHELL_REDIRECTS=sell-queue,listings   only those pages (plus absorbed ones)
 *   VIP_SHELL_REDIRECTS=all   (or 1)          every page in the list
 *   VIP_SHELL_REDIRECTS=off   (or 0)          none, not even absorbed ones
 *
 * Write page names without the leading slash: Git Bash on Windows rewrites
 * "/sell-queue" into a file path. A leading slash still works elsewhere.
 * The value is read when the web app starts (next dev) or builds (next build).
 *
 * Pure module (no Next imports) so next.config.ts and the tests share it.
 */
export type ShellRedirectPage = {
  /** The old page; also the name used in VIP_SHELL_REDIRECTS. */
  page: string;
  /** URL patterns that belong to the page (the page itself and its sub-paths). */
  sources: string[];
  destination: string;
  /** True once the concept destination does this page's job. */
  absorbed: boolean;
  /** What the concept still lacks, while not absorbed. */
  missing?: string;
};

export const SHELL_REDIRECT_PAGES: ShellRedirectPage[] = [
  { page: "/portfolio", sources: ["/portfolio"], destination: "/vault", absorbed: false, missing: "portfolio totals and holding table" },
  {
    page: "/collections",
    sources: ["/collections", "/collections/:path*"],
    destination: "/vault",
    absorbed: false,
    missing: "Comics and Pokémon terminals",
  },
  { page: "/scan", sources: ["/scan"], destination: "/ingest", absorbed: false, missing: "Ricoh intake, bulk review, confirm list" },
  { page: "/batch", sources: ["/batch/:path*"], destination: "/ingest", absorbed: false, missing: "batch detail" },
  {
    page: "/intelligence",
    sources: ["/intelligence"],
    destination: "/advisor",
    absorbed: false,
    missing: "intelligence desk forms and prediction resolve form",
  },
  { page: "/recommendations", sources: ["/recommendations"], destination: "/advisor", absorbed: false, missing: "recommendation list" },
  { page: "/signals-feed", sources: ["/signals-feed"], destination: "/signals", absorbed: false, missing: "daily lists and Pokémon signals" },
  { page: "/sell-queue", sources: ["/sell-queue"], destination: "/operate/sell", absorbed: false, missing: "collector sell-priority list" },
  { page: "/listings", sources: ["/listings"], destination: "/operate/listings", absorbed: false, missing: "listing draft editor" },
  { page: "/transactions", sources: ["/transactions"], destination: "/operate/transactions", absorbed: false, missing: "transaction detail" },
  { page: "/ebay", sources: ["/ebay", "/ebay/:path*"], destination: "/operate/listings", absorbed: false, missing: "eBay sell engine" },
  { page: "/hunts", sources: ["/hunts"], destination: "/vault", absorbed: false, missing: "hunt boards" },
  { page: "/watchlist", sources: ["/watchlist"], destination: "/vault", absorbed: false, missing: "watchlist" },
  { page: "/theses", sources: ["/theses"], destination: "/advisor", absorbed: false, missing: "thesis board" },
  { page: "/sources", sources: ["/sources"], destination: "/operate/integrations", absorbed: false, missing: "Sources editor" },
];

export type NextRedirect = { source: string; destination: string; permanent: false };

/** Pages whose redirect is live for this env value. */
export function activeShellRedirectPages(setting: string | undefined): ShellRedirectPage[] {
  const raw = (setting ?? "").trim();
  const lower = raw.toLowerCase();
  if (lower === "off" || lower === "0") return [];
  const all = lower === "all" || lower === "1";
  const named = new Set(
    raw && !all
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => (s.startsWith("/") ? s : `/${s}`))
      : [],
  );
  return SHELL_REDIRECT_PAGES.filter((p) => all || p.absorbed || named.has(p.page));
}

/** The Next.js redirects() list. Temporary (307) so a page can be handed back. */
export function shellRedirects(setting: string | undefined): NextRedirect[] {
  return activeShellRedirectPages(setting).flatMap((p) =>
    p.sources.map((source) => ({ source, destination: p.destination, permanent: false as const })),
  );
}
