import { Nav } from "@/components/Nav";
import { TcgTerminal } from "@/components/tcg/TcgTerminal";

export default function TcgCollectionPage() {
  return (
    <div className="shell shell-bleed">
      <Nav active="/collections/tcg" />
      <TcgTerminal />
    </div>
  );
}
