import Link from "next/link";
import { CLASSIC_PAGE_GROUPS } from "@/lib/classicPages";

export default function ClassicPagesPage() {
  return (
    <div className="vip-screen">
      <div className="vip-screen-body">
        <header className="vip-screen-head">
          <div>
            <p className="vip-kicker">Classic pages</p>
            <h1>Every page from the old tab bar</h1>
            <p className="vip-muted">
              The five concepts above replace the old tabs (ADR 0014). These pages still work and are listed here until each one has a home
              inside a concept.
            </p>
          </div>
        </header>
        {CLASSIC_PAGE_GROUPS.map((group) => (
          <section key={group.title} style={{ marginBottom: 20 }}>
            <p className="vip-kicker">{group.title}</p>
            <ul>
              {group.pages.map((page) => (
                <li key={page.href}>
                  <Link href={page.href}>{page.label}</Link>
                  {page.note ? <span className="vip-muted"> · {page.note}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
