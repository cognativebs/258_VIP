import { Nav } from "@/components/Nav";
import { SportsTerminal } from "@/components/sports/SportsTerminal";

export default function SportsCollectionPage() {
  return (
    <div className="shell shell-bleed">
      <Nav active="/collections/sports" />
      <SportsTerminal />
    </div>
  );
}
