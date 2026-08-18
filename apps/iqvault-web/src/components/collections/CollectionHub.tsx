"use client";

import { Nav } from "@/components/Nav";
import { ComicsTerminal } from "@/components/comics/ComicsTerminal";
import { CollectionTabs } from "@/components/collections/CollectionTabs";
import { getCollectionTab, type CollectionTabId } from "@/lib/collectionTabs";

export function CollectionHub({ vertical }: { vertical: CollectionTabId }) {
  const tab = getCollectionTab(vertical);
  return (
    <div className="shell shell-bleed">
      <Nav active="/collections" />
      <div className="bb-collections-hub">
        <CollectionTabs activeId={tab.id} />
        <ComicsTerminal tabId={tab.id} />
      </div>
    </div>
  );
}
