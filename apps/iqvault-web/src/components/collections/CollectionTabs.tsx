"use client";

import Link from "next/link";
import { COLLECTION_GROUPS, COLLECTION_TABS } from "@/lib/collectionTabs";

export function CollectionTabs({ activeId }: { activeId: string }) {
  return (
    <nav className="bb-collections-bar" aria-label="Collection verticals">
      {COLLECTION_GROUPS.map((group) => {
        const tabs = COLLECTION_TABS.filter((t) => t.group === group.id);
        return (
          <div key={group.id} className="bb-collections-group">
            <span className="bb-collections-group-label">{group.label}</span>
            <div className="bb-collections-tabs">
              {tabs.map((tab) => (
                <Link
                  key={tab.id}
                  href={`/collections/${tab.id}`}
                  className={`bb-collection-tab ${activeId === tab.id ? "active" : ""} live`}
                  title={tab.label}
                >
                  <span className="bb-collection-tab-label">{tab.shortLabel}</span>
                  <span className="bb-collection-tab-badge">LIVE</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
