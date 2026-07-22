import { Nav } from "@/components/Nav";
import { apiGet } from "@/lib/api";

type HuntItem = {
  id: string;
  name: string;
  status: "owned" | "wanted" | "missing";
  priority: string;
  buyUnder: number | null;
  market: number | null;
};

type Hunt = {
  id: string;
  name: string;
  description: string;
  metrics: {
    owned: number;
    wanted: number;
    missing: number;
    total: number;
    completionPct: number;
  };
  sections: { id: string; name: string; items: HuntItem[] }[];
};

export default async function HuntsPage() {
  let hunts: Hunt[] = [];
  let error: string | null = null;
  try {
    const data = await apiGet<{ hunts: Hunt[] }>("/api/hunts");
    hunts = data.hunts;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load hunts";
  }

  return (
    <>
      <Nav active="/hunts" />
      <h1 className="page-title">Collection Hunts</h1>
      <p className="page-sub">
        Image-first Owned / Wanted / Missing galleries. Absolute Batman + Pokémon 30th seeds.
      </p>
      {error ? <div className="error">{error}</div> : null}

      {hunts.map((hunt) => (
        <section key={hunt.id} style={{ marginBottom: 36 }}>
          <h2 style={{ fontFamily: "Fraunces, serif", marginBottom: 4 }}>{hunt.name}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {hunt.description} · {hunt.metrics.completionPct}% complete (
            {hunt.metrics.owned}/{hunt.metrics.total})
          </p>
          {hunt.sections.map((section) => (
            <div key={section.id} style={{ marginTop: 18 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>{section.name}</h3>
              <div className="hunt-gallery">
                {section.items.map((item) => (
                  <div key={item.id} className="hunt-tile">
                    <div className="hunt-art" aria-hidden />
                    <div className="hunt-meta">
                      <div className="name">{item.name}</div>
                      <div className={`status-${item.status}`} style={{ fontSize: 12, marginTop: 4 }}>
                        {item.status.toUpperCase()}
                        {item.buyUnder != null ? ` · buy under $${item.buyUnder}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
