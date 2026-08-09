import type { Provenance } from "@/lib/api";

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const inferred = provenance.method === "inferred" || provenance.verificationStatus !== "verified";
  return (
    <span
      className={`badge ${inferred ? "badge-warn" : "badge-ok"}`}
      title={`${provenance.source} · ${provenance.ruleOrModelVersion}`}
    >
      {inferred
        ? provenance.notes ?? `${provenance.method} · ${provenance.verificationStatus}`
        : `${provenance.method} · conf ${(provenance.confidence * 100).toFixed(0)}%`}
    </span>
  );
}

export function ConfidenceBadge({
  confidence,
  band,
}: {
  confidence: number;
  band?: string;
}) {
  return (
    <span className="badge badge-info">
      {band ?? "conf"} {(confidence * 100).toFixed(0)}%
    </span>
  );
}
