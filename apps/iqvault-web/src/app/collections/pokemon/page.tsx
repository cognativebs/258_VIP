import { Nav } from "@/components/Nav";
import { CollectionsHub } from "@/components/collections/CollectionsHub";
import { ComicsTerminal } from "@/components/comics/ComicsTerminal";

export default function PokemonCollectionPage() {
  return (
    <div className="shell shell-bleed">
      <Nav active="/collections/pokemon" />
      <CollectionsHub activeId="pokemon">
        <ComicsTerminal vertical="pokemon" />
      </CollectionsHub>
    </div>
  );
}
