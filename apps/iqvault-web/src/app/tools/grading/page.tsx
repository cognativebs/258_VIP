import { GradingTool } from "@/components/tools/GradingTool";

export default function GradingPage() {
  return (
    <div className="shell">
      <h1 className="page-title">Break-Even Grading Calculator</h1>
      <p className="page-sub">
        $19. PSA / CGC / BGS fee snapshot as of 2026-09-13 — confirm at checkout. Paused tiers stay labeled paused.
      </p>
      <GradingTool />
    </div>
  );
}
