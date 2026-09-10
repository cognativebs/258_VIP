"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiGet } from "@/lib/api";

type Experiment = {
  experimentId: string;
  name: string;
  hypothesis: string;
  strategy: string;
  status: string;
};

type Evaluation = {
  declaredWinner: string | null;
  note: string;
  results: { cohortId: string; n: number; uncertainty: string }[];
};

export default function EbayExperimentsPage() {
  const [data, setData] = useState<{ experiments: Experiment[]; evaluation: Evaluation } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ experiments: Experiment[]; evaluation: Evaluation }>("/api/ebay/sell/experiments")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Experiments failed"));
  }, []);

  return (
    <div className="shell">
      <Nav active="/ebay" />
      <h1 className="page-title">Selling experiments</h1>
      <p className="page-sub">
        First experiment: ~300 comparable $1–$5 cards, singles vs player lots vs team/set lots.
        Winners are never auto-declared on tiny samples — counts and uncertainty stay visible.
      </p>
      <p className="muted">
        <Link href="/ebay">eBay dashboard</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {(data?.experiments ?? []).map((exp) => (
        <div className="panel" key={exp.experimentId}>
          <h3>{exp.name}</h3>
          <p>{exp.hypothesis}</p>
          <p className="muted">
            {exp.experimentId} · {exp.strategy} · {exp.status}
          </p>
        </div>
      ))}
      <div className="panel">
        <h3>Evaluation</h3>
        <p>{data?.evaluation.note}</p>
        <p className="muted">Declared winner: {data?.evaluation.declaredWinner ?? "none"}</p>
      </div>
    </div>
  );
}
