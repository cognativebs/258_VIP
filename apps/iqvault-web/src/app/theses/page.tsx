import { Nav } from "@/components/Nav";
import { apiGet } from "@/lib/api";

export default async function ThesesPage() {
  let error: string | null = null;
  let theses: {
    id: string;
    claim: string;
    horizon: string;
    status: string;
    linkedAssetNames: string[];
  }[] = [];
  try {
    const data = await apiGet<{ theses: typeof theses }>("/api/theses");
    theses = data.theses;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load theses";
  }

  return (
    <div className="shell">
      <><Nav active="/theses" />
      <h1 className="page-title">Theses</h1>
      <p className="page-sub">Stated beliefs with horizon — not silent inventory notes.</p>
      {error ? <div className="error">{error}</div> : null}
      <div className="stack">
        {theses.map((t) => (
          <article key={t.id} className="panel">
            <div>
              <span className="badge badge-ok">{t.status}</span>
              <span className="badge">{t.horizon}</span>
            </div>
            <h3 style={{ marginTop: 10 }}>{t.claim}</h3>
            <p className="muted" style={{ marginBottom: 0 }}>
              Linked: {t.linkedAssetNames.join(", ") || "—"}
            </p>
          </article>
        ))}
      </div>
      </>
    </div>
  );
}
