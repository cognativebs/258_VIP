"use client";

import { useState } from "react";
import { apiPost } from "@/lib/api";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span className="muted">{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  borderRadius: 8,
  padding: "8px 10px",
};

export function IntelligenceDesk() {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setErr(null);
    setMsg(null);
    try {
      const result = await fn();
      const preview = result != null ? ` ${JSON.stringify(result).slice(0, 220)}` : "";
      setMsg(`${label} saved.${preview} Refresh if this was a ledger write.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="stack">
      <article className="panel">
        <h3>Desk — write around the HOLDs</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Persists to JSON (not Postgres). Cycle rows stay <code>manual</code>. Field
          captures stay <code>needs_review</code>. No auction/trade math.
        </p>
        {msg ? <p className="badge badge-ok">{msg}</p> : null}
        {err ? <div className="error">{err}</div> : null}
      </article>

      <article className="panel">
        <h3>1. Prediction</h3>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run("Prediction", () =>
              apiPost("/api/intelligence/predictions", {
                assetId: String(f.get("assetId")),
                priceAtPrediction: Number(f.get("price")),
                horizonDays: Number(f.get("horizon")),
                probabilityDown: Number(f.get("pDown")),
                probabilitySideways: Number(f.get("pSide")),
                probabilityUp: Number(f.get("pUp")),
                assumptions: String(f.get("assumptions") || ""),
              }),
            );
          }}
        >
          <div className="evidence">
            <Field label="Asset key">
              <input name="assetId" required style={inputStyle} placeholder="mega-greninja-ex-sir" />
            </Field>
            <Field label="Price at prediction">
              <input name="price" type="number" step="0.01" required defaultValue={230} style={inputStyle} />
            </Field>
            <Field label="Horizon days">
              <input name="horizon" type="number" required defaultValue={90} style={inputStyle} />
            </Field>
            <Field label="P(down) / sideways / up">
              <div style={{ display: "flex", gap: 6 }}>
                <input name="pDown" type="number" step="0.01" defaultValue={0.55} style={inputStyle} />
                <input name="pSide" type="number" step="0.01" defaultValue={0.3} style={inputStyle} />
                <input name="pUp" type="number" step="0.01" defaultValue={0.15} style={inputStyle} />
              </div>
            </Field>
          </div>
          <Field label="Assumptions">
            <input name="assumptions" style={inputStyle} placeholder="Post-release compression" />
          </Field>
          <button type="submit" className="nav-link on">Freeze prediction</button>
        </form>
      </article>

      <article className="panel">
        <h3>Underwrite / grade</h3>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run("Underwriting", () =>
              apiPost("/api/intelligence/underwriting", {
                lotDescription: String(f.get("lot") || "Lot"),
                askingPrice: Number(f.get("ask")),
                offerPrice: Number(f.get("offer")),
                conservativeRawValue: Number(f.get("lp")),
              }),
            );
          }}
        >
          <div className="evidence">
            <Field label="Lot">
              <input name="lot" defaultValue="Vintage Pokémon lot" style={inputStyle} />
            </Field>
            <Field label="Ask / offer / conservative LP">
              <div style={{ display: "flex", gap: 6 }}>
                <input name="ask" type="number" defaultValue={750} style={inputStyle} />
                <input name="offer" type="number" defaultValue={700} style={inputStyle} />
                <input name="lp" type="number" defaultValue={1045} style={inputStyle} />
              </div>
            </Field>
          </div>
          <button type="submit" className="nav-link on">Underwrite (flag, never block)</button>
        </form>
        <form
          className="stack"
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run("Grading", () =>
              apiPost("/api/intelligence/grading", {
                holdingId: String(f.get("holdingId")),
                rawValue: Number(f.get("raw")),
                gradingCost: Number(f.get("gcost")),
                notes: String(f.get("gnotes") || ""),
              }),
            );
          }}
        >
          <div className="evidence">
            <Field label="Holding key">
              <input name="holdingId" required style={inputStyle} placeholder="flareon-raw" />
            </Field>
            <Field label="Raw value / grading cost">
              <div style={{ display: "flex", gap: 6 }}>
                <input name="raw" type="number" defaultValue={80} style={inputStyle} />
                <input name="gcost" type="number" defaultValue={25} style={inputStyle} />
              </div>
            </Field>
          </div>
          <Field label="Notes">
            <input name="gnotes" style={inputStyle} placeholder="PSA 9/10 omitted → inspect_further" />
          </Field>
          <button type="submit" className="nav-link on">Evaluate grading</button>
        </form>
      </article>

      <article className="panel">
        <h3>Cohen cover score</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Geometric mean of six 1–10 factors minus variant-dilution penalty. Not “buy the artist.”
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run("Cohen score", () =>
              apiPost("/api/intelligence/cohen-score", {
                title: String(f.get("ctitle")),
                artistSignificance: Number(f.get("csig")),
                characterStrength: Number(f.get("cchar")),
                imageIconicity: Number(f.get("cicon")),
                historicalImportance: Number(f.get("chist")),
                trueScarcity: Number(f.get("cscarc")),
                entryPrice: Number(f.get("cprice")),
                variantDilutionPenalty: Number(f.get("cdil")),
              }),
            );
          }}
        >
          <Field label="Title">
            <input name="ctitle" defaultValue="Poison Ivy #9 Harley/Ivy" style={inputStyle} />
          </Field>
          <div className="evidence">
            <Field label="Artist / character / icon / history / scarcity / cheap-ask / dilution">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <input name="csig" type="number" defaultValue={9} min={1} max={10} style={inputStyle} />
                <input name="cchar" type="number" defaultValue={9} min={1} max={10} style={inputStyle} />
                <input name="cicon" type="number" defaultValue={10} min={1} max={10} style={inputStyle} />
                <input name="chist" type="number" defaultValue={7} min={1} max={10} style={inputStyle} />
                <input name="cscarc" type="number" defaultValue={3} min={1} max={10} style={inputStyle} />
                <input name="cprice" type="number" defaultValue={10} min={1} max={10} style={inputStyle} />
                <input name="cdil" type="number" defaultValue={3} min={0} max={5} style={inputStyle} />
              </div>
            </Field>
          </div>
          <button type="submit" className="nav-link on">Score cover</button>
        </form>
      </article>

      <article className="panel">
        <h3>5. Manual cycle desk</h3>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run("Manual cycle", () =>
              apiPost("/api/intelligence/cycle", {
                assetId: String(f.get("cycleAsset")),
                cycleState: String(f.get("cycleState")),
                notes: String(f.get("cycleNotes") || ""),
                watchNote: String(f.get("watchNote") || ""),
              }),
            );
          }}
        >
          <div className="evidence">
            <Field label="Asset key">
              <input name="cycleAsset" defaultValue="drew-brees" style={inputStyle} />
            </Field>
            <Field label="Cycle state (manual)">
              <select name="cycleState" defaultValue="accumulation" style={inputStyle}>
                <option value="fomo">fomo</option>
                <option value="cooling">cooling</option>
                <option value="accumulation">accumulation</option>
                <option value="recovery">recovery</option>
                <option value="blue_chip">blue_chip</option>
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <input name="cycleNotes" style={inputStyle} placeholder="Catalyst passed — evaluate window" />
          </Field>
          <Field label="Watch note">
            <input name="watchNote" style={inputStyle} placeholder="Entered Accumulation Watch" />
          </Field>
          <button type="submit" className="nav-link on">Record manual row</button>
        </form>
      </article>

      <article className="panel">
        <h3>6–7. Store/Show capture + golden case</h3>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run("Field session", async () => {
              const session = await apiPost<{ session: { id: string } }>(
                "/api/intelligence/sessions",
                {
                  mode: String(f.get("mode")),
                  locationContext: String(f.get("location") || ""),
                },
              );
              return apiPost(`/api/intelligence/sessions/${session.session.id}/capture`, {
                askingPrice: Number(f.get("askPrice")),
                conservativeRawValue: Number(f.get("cons")),
                imageRef: String(f.get("imageRef") || ""),
              });
            });
          }}
        >
          <div className="evidence">
            <Field label="Mode">
              <select name="mode" defaultValue="store" style={inputStyle}>
                <option value="store">store</option>
                <option value="show">show</option>
              </select>
            </Field>
            <Field label="Location">
              <input name="location" style={inputStyle} placeholder="Local game store" />
            </Field>
            <Field label="Ask / conservative">
              <div style={{ display: "flex", gap: 6 }}>
                <input name="askPrice" type="number" defaultValue={40} style={inputStyle} />
                <input name="cons" type="number" defaultValue={55} style={inputStyle} />
              </div>
            </Field>
            <Field label="Image ref (pointer, not the file)">
              <input name="imageRef" style={inputStyle} placeholder="s3://scans/shelf-1.jpg" />
            </Field>
          </div>
          <button type="submit" className="nav-link on">Capture (needs_review)</button>
        </form>
        <form
          className="stack"
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run("Golden case", () =>
              apiPost("/api/intelligence/golden-cases", {
                imageRef: String(f.get("gImage")),
                knownCorrectAssetId: String(f.get("gAsset")),
                category: String(f.get("gCat") || "base"),
              }),
            );
          }}
        >
          <div className="evidence">
            <Field label="Scan image ref">
              <input name="gImage" required style={inputStyle} placeholder="s3://golden/nami-01.jpg" />
            </Field>
            <Field label="Known-correct asset key">
              <input name="gAsset" required style={inputStyle} placeholder="one-piece-nami" />
            </Field>
            <Field label="Category">
              <input name="gCat" defaultValue="base" style={inputStyle} />
            </Field>
          </div>
          <button type="submit" className="nav-link on">Add golden case</button>
        </form>
      </article>
    </div>
  );
}
