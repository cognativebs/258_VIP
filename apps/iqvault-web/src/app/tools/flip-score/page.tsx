import { FlipScoreTool } from "@/components/tools/FlipScoreTool";
import { Nav } from "@/components/Nav";

export default function FlipScorePage() {
  return (
    <div className="shell">
      <Nav active="/tools" />
      <h1 className="page-title">Flip Score Deal Sheet</h1>
      <p className="page-sub">
        $37. Pays for itself vs one bad $200 buy or one wasted grading ticket. Target resale is a range.
      </p>
      <FlipScoreTool />
    </div>
  );
}
