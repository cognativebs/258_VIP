"use client";

import type { ReactNode } from "react";
import { SourceDropZone, type SourceDropZoneProps } from "@/components/SourceDropZone";
import type { SourceLink } from "@/lib/sourceDrop";

export function CollectionSourceBar({
  links,
  drop,
  children,
}: {
  links: SourceLink[];
  drop: Omit<SourceDropZoneProps, "children" | "toolbar">;
  children?: ReactNode;
}) {
  return (
    <SourceDropZone
      {...drop}
      toolbar={
        <div className="src-bar-links">
          {links.map((link) => (
            <a
              key={link.href + link.label}
              className="src-bar-link"
              href={link.href}
              target="_blank"
              rel="noreferrer"
              title={link.title ?? `Open ${link.label} in a new window`}
            >
              {link.label} ↗
            </a>
          ))}
        </div>
      }
    >
      {children}
    </SourceDropZone>
  );
}
