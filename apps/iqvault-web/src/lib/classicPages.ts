/**
 * Pages from the old IQVault tab bar. ADR 0014 keeps them reachable by URL but
 * not as tabs; this list is the one place they stay discoverable.
 */
export type ClassicPage = { href: string; label: string; note: string };

export const CLASSIC_PAGE_GROUPS: { title: string; pages: ClassicPage[] }[] = [
  {
    title: "Collections",
    pages: [
      { href: "/portfolio", label: "Portfolio", note: "The old home page" },
      { href: "/collections", label: "Collections hub", note: "Comics, Pokémon, Sports" },
      { href: "/collections/comics", label: "Comics terminal", note: "Grid, filters, CLZ drop zone" },
      { href: "/collections/pokemon", label: "Pokémon terminal", note: "Binder holdings + FMV guide" },
      { href: "/collections/sports", label: "Sports", note: "Stub" },
      { href: "/hunts", label: "Hunts", note: "Hunt definitions and shelf completion" },
    ],
  },
  {
    title: "Intake",
    pages: [
      { href: "/scan", label: "Scan review", note: "Ricoh batches, confirm list" },
      { href: "/batch/001", label: "Batch 001", note: "Batch inspector" },
    ],
  },
  {
    title: "Decisions",
    pages: [
      { href: "/intelligence", label: "Intelligence desk", note: "Predictions, underwriting, binder chase" },
      { href: "/recommendations", label: "Recommendations", note: "Decision-engine output" },
      { href: "/tools", label: "Tools", note: "Comp check, flip score, grading" },
      { href: "/watchlist", label: "Watchlist", note: "" },
    ],
  },
  {
    title: "Selling",
    pages: [
      { href: "/sell-queue", label: "Sell queue", note: "" },
      { href: "/listings", label: "Listings", note: "" },
      { href: "/ebay", label: "eBay", note: "Queue, lots, experiments" },
      { href: "/transactions", label: "Transactions", note: "" },
    ],
  },
  {
    title: "Signals",
    pages: [
      { href: "/signals-feed", label: "Signals feed", note: "Daily lists, Pokémon SIGNALS, Orchestr8 hand-off" },
      { href: "/signals/desk", label: "Signal Desk", note: "Briefs, theses, calls to score, feed health" },
      { href: "/theses", label: "Theses", note: "" },
      { href: "/sources", label: "Sources", note: "Job-feed source registry" },
    ],
  },
];
