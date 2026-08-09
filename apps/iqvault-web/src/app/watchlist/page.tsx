import { Nav } from "@/components/Nav";
import { apiGet } from "@/lib/api";

type WatchRow = {
  id: string;
  assetName: string;
  note: string;
  addedAt: string;
  source?: string;
  provenance?: { source: string; verificationStatus: string };
};

export default async function WatchlistPage() {
  let error: string | null = null;
  let watchlist: WatchRow[] = [];
  let source: string | null = null;
  try {
    const data = await apiGet<{ watchlist: WatchRow[]; source?: string }>("/api/watchlist");
    watchlist = data.watchlist;
    source = data.source ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load watchlist";
  }

  return (
    <div className="shell">
      <><Nav active="/watchlist" />
      <h1 className="page-title">Watchlist</h1>
      <p className="page-sub">
        Durable Binder wishlist rows plus attention-derived comics. Not a fabricated top-N.
        {source ? ` · source: ${source}` : ""}
      </p>
      {error ? <div className="error">{error}</div> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Note</th>
              <th>Source</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.map((w) => (
              <tr key={w.id}>
                <td>{w.assetName}</td>
                <td className="muted">{w.note}</td>
                <td className="muted">{w.source ?? w.provenance?.source ?? "derived"}</td>
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
