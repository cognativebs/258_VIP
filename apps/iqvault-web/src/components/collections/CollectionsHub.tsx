import type { ReactNode } from "react";
import { CollectionTabs } from "./CollectionTabs";

/** Same chrome as the original IQVault HTML collections terminal. */
export function CollectionsHub({
  activeId,
  children,
}: {
  activeId: string;
  children: ReactNode;
}) {
  return (
    <div className="bb-collections-hub">
      <CollectionTabs activeId={activeId} />
      {children}
    </div>
  );
}
