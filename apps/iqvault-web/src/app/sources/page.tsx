import { Nav } from "@/components/Nav";
import { apiGet } from "@/lib/api";

export default async function SourcesPage() {
  let error: string | null = null;
  let sources: {
    id: string;
    name: string;
    authority: string;
    accessMethod: string;
    categoryCoverage: string[];
    notes: string;
  }[] = [];
  try {
    const data = await apiGet<{ sources: typeof sources }>("/api/sources");
    sources = data.sources;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load sources";
  }

  return (
    <div className="shell">
      <><Nav active="/sources" />
      <h1 className="page-title">Sources</h1>
      <p className="page-sub">
        Registry of inputs. Core logic must not depend on one scraper.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <div className="stack">
        {sources.map((s) => (
          <article key={s.id} className="panel">
            <h3>{s.name}</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {s.authority} · {s.accessMethod} · {s.categoryCoverage.join(", ")}
            </p>
            <p style={{ marginBottom: 0 }}>{s.notes}</p>
          </article>
        ))}
      </div>
      </>
    </div>
  );
}
