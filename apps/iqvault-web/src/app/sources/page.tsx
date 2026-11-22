import { SourcesEditor } from "@/components/sources/SourcesEditor";
import { apiGet } from "@/lib/api";
import { SourcesListSchema, type SourceRow } from "@/lib/sourcesApi";

export default async function SourcesPage() {
  let error: string | null = null;
  let sources: SourceRow[] = [];
  try {
    sources = SourcesListSchema.parse(await apiGet<unknown>("/api/sources")).sources;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load sources";
  }

  return (
    <div className="shell">
      <h1 className="page-title">Sources</h1>
      <p className="page-sub">
        Job feed registry. Core logic must not depend on one scraper.
      </p>
      <div className="panel" role="note">
        <p style={{ margin: 0 }}>
          <strong>These toggles affect the job feed registry only</strong> (
          <code>sources-state.json</code>, read by the Pokémon drops and eBay comps jobs on their
          next run). They do not enable, disable, or change any news source in the SIGNALS spine
          (<code>vault_core.signals_news_source</code>); those are turned on only by the operator
          command <code>npm run news-source -- enable … --confirm-operator</code>.
        </p>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {!error && sources.length === 0 ? <p className="muted">No sources registered.</p> : null}
      <SourcesEditor initial={sources} />
    </div>
  );
}
