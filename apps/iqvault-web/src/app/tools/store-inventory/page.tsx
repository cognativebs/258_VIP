import { StoreTool } from "@/components/tools/StoreTool";
import { Nav } from "@/components/Nav";

export default function StoreInventoryPage() {
  return (
    <div className="shell">
      <Nav active="/tools" />
      <h1 className="page-title">Card Store Inventory &amp; Margin</h1>
      <p className="page-sub">
        $147 B2B. Reorder triggers, category floors, seasonal notes, dead-stock liquidation. Not a vibe spreadsheet.
      </p>
      <StoreTool />
    </div>
  );
}
