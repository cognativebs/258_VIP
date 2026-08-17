import Link from "next/link";
import { Nav } from "@/components/Nav";
import { apiGet, type InventoryResponse } from "@/lib/api";
import { COLLECTIONS, isComicHolding, splitTcgHoldings } from "@/lib/collections";

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  let data: InventoryResponse | null = null;
  let error: string | null = null;
  try {
    data = await apiGet<InventoryResponse>("/api/inventory");
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load inventory";
  }

  const holdings = data?.holdings ?? [];
  const comicsCount = data?.comicsCount ?? holdings.filter(isComicHolding).length;
  const pokemon = splitTcgHoldings(holdings);
  const pokemonCount = (pokemon.owned.length || pokemon.seeds.length) + pokemon.need.length;

  const counts: Record<string, number> = {
    comics: comicsCount,
    pokemon: pokemonCount,
  };

  return (
    <div className="shell">
      <Nav active="/collections" />
      <h1 className="page-title">Collections</h1>
      <p className="page-sub">
        One backend, one Postgres. Each asset class gets its own terminal instead of a
        comics-only view. Pokémon lives at <Link href="/collections/pokemon">/collections/pokemon</Link>.
      </p>

      {error ? (
        <div className="error">
          {error}. Start the API with <code>npm run api</code> (port 8787).
        </div>
      ) : null}

      <div className="stack">
        {COLLECTIONS.map((c) => (
          <article key={c.id} className="panel">
            <div className="collection-card">
              <div>
                <h3 style={{ margin: 0 }}>
                  <Link href={c.href}>{c.label}</Link>
                </h3>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                  {c.blurb}
                </p>
              </div>
              <div className="collection-count">
                <div className="n">{counts[c.id]?.toLocaleString() ?? "—"}</div>
                <div className="l">holdings</div>
              </div>
            </div>
          </article>
        ))}
      </div>

      <p className="muted" style={{ fontSize: 13 }}>
        Sports cards can also arrive through <Link href="/scan">Scan intake</Link>. The{" "}
        <Link href="/collections/sports">Sports terminal</Link> is a stub until holdings
        exist — same source-bar pattern as Comics, drop zone off.
      </p>
    </div>
  );
}
