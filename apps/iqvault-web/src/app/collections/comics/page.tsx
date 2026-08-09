import { Nav } from "@/components/Nav";
import { ComicsTerminal } from "@/components/comics/ComicsTerminal";

export default function ComicsCollectionPage() {
  return (
    <div className="shell shell-bleed">
      <Nav active="/collections/comics" />
      <ComicsTerminal />
    </div>
  );
}
