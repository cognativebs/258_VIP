"use client";

import type { ReactNode } from "react";
import { CollectionSourceBar } from "@/components/CollectionSourceBar";
import type { SourceDropZoneProps } from "@/components/SourceDropZone";
import type { SourceLink } from "@/lib/sourceDrop";

/** Bloomberg-style shell for collection terminals that are not comics-complete yet. */
export function CollectionTerminalStub({
  kicker,
  title,
  sourceLine,
  links,
  drop,
  children,
}: {
  kicker: string;
  title: string;
  sourceLine: string;
  links: SourceLink[];
  drop: Omit<SourceDropZoneProps, "children" | "toolbar">;
  children: ReactNode;
}) {
  return (
    <div className="bb-terminal bb-terminal-embedded">
      <CollectionSourceBar links={links} drop={drop}>
        <div className="bb-topbar">
          <div className="bb-topbar-brand">
            <span className="bb-orange">IQVAULT</span>
            <span className="bb-dim">{title}</span>
            <span className="bb-dim" style={{ marginLeft: 8 }}>
              · {sourceLine}
            </span>
          </div>
        </div>
        <div className="bb-stub-body">
          <p className="bb-stub-kicker">{kicker}</p>
          {children}
        </div>
      </CollectionSourceBar>
    </div>
  );
}
