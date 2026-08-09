import { Nav } from "@/components/Nav";
import { apiGet } from "@/lib/api";

export default async function WatchlistPage() {
  let error: string | null = null;
  let watchlist: { id: string; assetName: string; note: string; addedAt: string }[] = [];
  try {
    const data = await apiGet<{ watchlist: typeof watchlist }>("/api/watchlist");
    watchlist = data.watchlist;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load watchlist";
  }

  return (
    <div className="shell">
      <><Nav active="/watchlist" />
      <h1 className="page-title">Watchlist</h1>
      <p className="page-sub">Items staged for later Ask / Watch decisions.</p>
      {error ? <div className="error">{error}</div> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Note</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.map((w) => (
              <tr key={w.id}>
                <td>{w.assetName}</td>
                <td className="muted">{w.note}</td>
                <td>{w.addedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
    </div>
  );
}
