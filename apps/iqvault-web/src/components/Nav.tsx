import Link from "next/link";

const BINDER_URL = process.env.NEXT_PUBLIC_BINDER_URL ?? "http://localhost:3010";

const links = [
  { href: "/", label: "Portfolio" },
  { href: "/collections", label: "Collections" },
  { href: "/collections/comics", label: "Comics" },
  { href: "/collections/tcg", label: "TCG" },
  { href: "/scan", label: "Scan" },
  { href: "/recommendations", label: "Recs" },
  { href: "/hunts", label: "Hunts" },
  { href: "/sell-queue", label: "Sell" },
  { href: "/signals", label: "Signals" },
  { href: "/watchlist", label: "Watch" },
  { href: "/theses", label: "Theses" },
  { href: "/sources", label: "Sources" },
];

export function Nav({ active }: { active?: string }) {
  return (
    <header className="top">
      <div className="brand">
        <div className="brand-mark">IQ</div>
        <div>
          <div className="brand-kicker">258 · Personal Intelligence</div>
          <Link href="/" className="brand-name">
            IQVault
          </Link>
        </div>
      </div>
      <nav className="nav" aria-label="Collector face">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={active === l.href ? "nav-link on" : "nav-link"}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <a
        className="ext-link"
        href={BINDER_URL}
        target="_blank"
        rel="noreferrer"
        title="Open Binder Vault"
      >
        Binder ↗
      </a>
    </header>
  );
}
