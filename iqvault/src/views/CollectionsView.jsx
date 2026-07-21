import { useState } from "react";
import CollectionTabs from "../components/collections/CollectionTabs.jsx";
import ComicsTerminalView from "./ComicsTerminalView.jsx";
import CollectionPlaceholderView from "./CollectionPlaceholderView.jsx";
import { getCollectionTab } from "../data/collections.js";

export default function CollectionsView() {
  const [activeId, setActiveId] = useState("comic");
  const collection = getCollectionTab(activeId);

  return (
    <div className="bb-collections-hub">
      <CollectionTabs activeId={activeId} onChange={setActiveId} />
      {collection.status === "live" ? (
        <ComicsTerminalView embedded />
      ) : (
        <CollectionPlaceholderView collection={collection} />
      )}
    </div>
  );
}
