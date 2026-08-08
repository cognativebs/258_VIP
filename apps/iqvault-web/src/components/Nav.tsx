import Link from "next/link";

const BINDER_URL = process.env.NEXT_PUBLIC_BINDER_URL ?? "http://localhost:3010";

const links = [
  { href: "/", label: "Portfolio" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/hunts", label: "Hunts" },
  { href: "/sell-queue", label: "Sell queue" },
  { href: "/signals", label: "Signals" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/theses", label: "Theses" },
  { href: "/sources", label: "Sources" },
];

export function Nav({ active }: { active?: string }) {
  return (
    <header className="top">
      <div className="brand">
        <div className="brand-kicker">258 · Collector face</div>
        <Link href="/" className="brand-name">
          IQVault
        </Link>
      </div>
      <nav className="nav">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={active === l.href ? "nav-link on" : "nav-link"}
          >
            {l.label}
          </Link>
        ))}
        <a
          href={BINDER_URL}
          className="nav-link"
          target="_blank"
          rel="noreferrer"
          title="Binder Vault (local app)"
        >
          Binder
        </a>
      </nav>
    </header>
  );
}
