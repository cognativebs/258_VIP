import { Nav } from "@/components/Nav";
import { TcgTerminal } from "@/components/tcg/TcgTerminal";

export default function PokemonCollectionPage() {
  return (
    <div className="shell shell-bleed">
      <Nav active="/collections/pokemon" />
      <TcgTerminal />
    </div>
  );
}
