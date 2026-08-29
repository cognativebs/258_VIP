import Link from "next/link";
import { popoutLinks } from "@/lib/popoutLinks";

const links = [
  { href: "/", label: "Portfolio" },
  { href: "/collections", label: "Collections" },
  { href: "/collections/comics", label: "Comics" },
  { href: "/collections/pokemon", label: "Pokémon" },
  { href: "/collections/sports", label: "Sports" },
  { href: "/scan", label: "Scan" },
  { href: "/intelligence", label: "Intel" },
  { href: "/recommendations", label: "Recs" },
  { href: "/hunts", label: "Hunts" },
  { href: "/sell-queue", label: "Sell" },
  { href: "/listings", label: "List" },
  { href: "/transactions", label: "Txns" },
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
      <div className="ext-links">
        {popoutLinks().map((l) => (
          <a
            key={l.id}
            className="ext-link"
            href={l.href}
            target="_blank"
            rel="noreferrer"
            title={l.title}
          >
            {l.label} ↗
          </a>
        ))}
      </div>
    </header>
  );
}
