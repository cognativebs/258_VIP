import Link from "next/link";
import { Nav } from "@/components/Nav";
import { ThesisCard } from "@/components/signals/ThesisCard";
import { apiGet } from "@/lib/api";
import type { DeskThesis } from "@/lib/signalsDesk";

export const dynamic = "force-dynamic";

export default async function ThesesPage() {
  let error: string | null = null;
  let theses: DeskThesis[] = [];
  try {
    theses = (await apiGet<{ theses: DeskThesis[] }>("/api/theses")).theses;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load theses";
  }
  const order = ["active", "draft", "retired", "invalidated"] as const;

  return (
    <div className="shell">
      <Nav active="/theses" />
      <h1 className="page-title">Theses</h1>
      <p className="page-sub">
        Stated beliefs with a horizon and an action, each resting on signals. Orchestr8 drafts them from the daily brief (inferred · unverified);
        only you activate, retire or invalidate one. <Link href="/signals/desk">Signal Desk →</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {!error && theses.length === 0 ? <p className="muted">No theses yet. The first daily brief drafts them.</p> : null}
      {order.map((status) => {
        const rows = theses.filter((t) => t.status === status);
        if (!rows.length) return null;
        return (
          <section key={status}>
            <h2 className="section-title" style={{ textTransform: "capitalize" }}>
              {status} ({rows.length})
            </h2>
            <div className="stack">
              {rows.map((t) => (
                <ThesisCard key={t.id} t={t} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
