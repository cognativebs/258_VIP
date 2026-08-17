import { Nav } from "@/components/Nav";
import { CollectionsHub } from "@/components/collections/CollectionsHub";
import { ComicsTerminal } from "@/components/comics/ComicsTerminal";

export default function ComicsCollectionPage() {
  return (
    <div className="shell shell-bleed">
      <Nav active="/collections/comics" />
      <CollectionsHub activeId="comic">
        <ComicsTerminal />
      </CollectionsHub>
    </div>
  );
}
