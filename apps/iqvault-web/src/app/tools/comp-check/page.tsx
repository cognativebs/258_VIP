import { Nav } from "@/components/Nav";
import { loadCompCheck, TOOL_EXPORT } from "@/lib/toolsApi";

export default async function CompCheckPage() {
  let error: string | null = null;
  let data: Awaited<ReturnType<typeof loadCompCheck>> | null = null;
  try {
    data = await loadCompCheck();
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load checklist";
  }

  return (
    <div className="shell">
      <Nav active="/tools" />
      <h1 className="page-title">The 90-Second Comp Check</h1>
      <p className="page-sub">
        $12 lead-magnet. Screenshot the field kit. Laminate the desk page. PriceCharting is last — it is a guide.
      </p>
      {error ? <div className="error">{error}</div> : null}
      {data ? (
        <div className="stack">
          <article className="panel">
            <h3>Order of operations</h3>
            <ol>
              {data.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </article>
          <div className="tool-grid">
            {data.redFlags.map((f) => (
              <article key={f.id} className="panel">
                <h3>{f.title}</h3>
                <ul className="muted">
                  {f.tells.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <p>{f.doInstead}</p>
              </article>
            ))}
          </div>
          <article className="panel">
            <h3>Sources</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Source</th>
                    <th>Use for</th>
                    <th>Caveat</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sources.map((s) => (
                    <tr key={s.name}>
                      <td>{s.order}</td>
                      <td>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.name} ↗
                        </a>
                      </td>
                      <td>{s.useFor}</td>
                      <td className="muted">{s.caveat}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
          <article className="panel">
            <a className="tool-btn" href={TOOL_EXPORT.compDesk}>
              Desk laminate HTML
            </a>{" "}
            <a className="tool-btn" href={TOOL_EXPORT.compField}>
              Field kit HTML
            </a>{" "}
            <a className="tool-btn ghost" href="/tools/print/comp-check">
              Print desk
            </a>{" "}
            <a className="tool-btn ghost" href="/tools/print/comp-check-field">
              Phone field kit
            </a>
          </article>
        </div>
      ) : null}
    </div>
  );
}
