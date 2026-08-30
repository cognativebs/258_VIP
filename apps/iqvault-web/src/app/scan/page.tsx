import { Nav } from "@/components/Nav";
import { ScanIntake } from "@/components/scan/ScanIntake";

export const dynamic = "force-dynamic";

export default function ScanPage() {
  return (
    <div className="shell">
      <Nav active="/scan" />
      <h1 className="page-title">Scan intake</h1>
      <p className="page-sub">
        Choose your Ricoh front/back images at the top, then review exceptions.
        Identity stays inferred · unverified until you confirm; condition remains
        NM assumed · unverified until a grading pass.
      </p>
      <ScanIntake />
    </div>
  );
}
