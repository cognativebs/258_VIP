import { Nav } from "@/components/Nav";
import { TOOL_EXPORT } from "@/lib/toolsApi";

const MODULES = [
  ["1", "The only decision that matters", "15", "Buy / Hold / Grade / Sell / Lot / Pass with a reason"],
  ["2", "Comp like a grown-up", "18", "90-second order + three traps"],
  ["3", "When grading is a fee, not a dream", "20", "Break-even at 7 / 8 / 9 / 9.5 / 10"],
  ["4", "Flip Score at a show", "15", "Run the deal sheet on two live asks"],
  ["5", "Sourcing: LCS, shows, estates", "20", "Relationship math, not hustle theater"],
  ["6", "eBay listing that actually sells", "18", "Title, comps, fees, lots"],
  ["7", "The weekly pipeline", "15", "Buy → decide → list → review"],
  ["8", "Store mode (optional)", "15", "Margin floors + dead-stock days"],
];

export default function CoursePage() {
  return (
    <div className="shell">
      <Nav active="/tools" />
      <h1 className="page-title">From Collector to Dealer</h1>
      <p className="page-sub">
        $197 flagship. Syllabus only — do not film this first. The four tools above are the toolkit bonus.
      </p>
      <article className="panel">
        <p className="badge badge-warn">No videos in-repo until the $12–$37 products have receipts.</p>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Module</th>
                <th>Min</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m[0]}>
                  <td>{m[0]}</td>
                  <td>{m[1]}</td>
                  <td>{m[2]}</td>
                  <td>{m[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 16 }}>
          <a className="tool-btn" href={TOOL_EXPORT.flipNotion}>
            Flip Score
          </a>{" "}
          <a className="tool-btn" href={TOOL_EXPORT.gradingXls}>
            Grading sheet
          </a>{" "}
          <a className="tool-btn" href={TOOL_EXPORT.compDesk}>
            Comp check
          </a>{" "}
          <a className="tool-btn" href={TOOL_EXPORT.storeNotion}>
            Store base
          </a>
        </p>
      </article>
    </div>
  );
}
