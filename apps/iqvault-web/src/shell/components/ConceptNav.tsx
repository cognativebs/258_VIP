"use client";

import type { ConceptId } from "../schemas";
import { conceptHref, HOME_HREF } from "../routes";

export function ConceptNav({
  order,
  active,
}: {
  order: readonly ConceptId[];
  active: ConceptId | "HOME" | null;
}) {
  return (
    <nav className="vip-nav" aria-label="Primary">
      {order.map((id) => (
        <a
          key={id}
          href={conceptHref(id)}
          data-concept={id}
          className={active === id ? "vip-nav-link is-active" : "vip-nav-link"}
          aria-current={active === id ? "page" : undefined}
        >
          {id}
        </a>
      ))}
    </nav>
  );
}

export function Wordmark() {
  return (
    <a className="vip-wordmark" href={HOME_HREF}>
      <span className="vip-wordmark-mark">VIP</span>
      <span className="vip-wordmark-kicker">Vault Intelligence</span>
    </a>
  );
}
