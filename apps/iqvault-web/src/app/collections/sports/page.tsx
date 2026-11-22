import { CollectionsHub } from "@/components/collections/CollectionsHub";
import { SportsTerminal } from "@/components/sports/SportsTerminal";

export default function SportsCollectionPage() {
  return (
    <div className="shell shell-bleed">
      <CollectionsHub activeId="football">
        <SportsTerminal />
      </CollectionsHub>
    </div>
  );
}
