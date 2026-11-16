"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { popoutLinks } from "@/lib/popoutLinks";
import { CommandPalette } from "./components/CommandPalette";
import { ConceptNav, Wordmark } from "./components/ConceptNav";
import { useRole } from "./role-context";
import { conceptFromPath } from "./routes";
import type { RoleId } from "./schemas";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <ShellFrame pathname={pathname}>{children}</ShellFrame>;
}

export function ShellFrame({
  pathname,
  children,
}: {
  pathname: string;
  children: ReactNode;
}) {
  const { role, choices, setRoleId } = useRole();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const active = conceptFromPath(pathname);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="vip-app" data-role={role.id}>
      <header className="vip-header">
        <Wordmark />
        <ConceptNav order={role.order} active={active} />
        <div className="vip-header-tools">
          <nav className="vip-companions" aria-label="Companion apps">
            {popoutLinks().map((link) => (
              <a key={link.id} className="vip-popout" href={link.href} title={link.title} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
          </nav>
          <button type="button" className="vip-search-btn" onClick={() => setPaletteOpen(true)}>
            Search
            <kbd>Ctrl K</kbd>
          </button>
          <label className="vip-role">
            <span>Role</span>
            <select
              aria-label="Role"
              value={role.id}
              onChange={(event) => setRoleId(event.target.value as RoleId)}
            >
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <main className="vip-main">{children}</main>
    </div>
  );
}
