import { useState, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// VaultOS — Acquisition Engine (reference prototype)
// MERGED INTO: demo/src/lib/offerEngine.js + demo/src/views/AcquireView.jsx
// This file is kept for reference; run the demo app for the integrated version.
// ─────────────────────────────────────────────────────────────────────────────

// PRICING LOGIC — this is the store's IP, not AI guessing.
// Given an identified card + market value + condition signals, compute the offer.
const OFFER_CONFIG = {
  // Base buy percentages by price tier (stores pay less % on cheap cards — handling cost)
  tiers: [
    { max: 5,    buyPct: 0.30, label: "Bulk" },
    { max: 20,   buyPct: 0.45, label: "Low" },
    { max: 75,   buyPct: 0.55, label: "Mid" },
    { max: 300,  buyPct: 0.62, label: "High" },
    { max: 1000, buyPct: 0.68, label: "Premium" },
    { max: Infinity, buyPct: 0.72, label: "Grail" },
  ],
  // Sell-through expectation by demand signal — affects how aggressive to be
  demandMultiplier: { hot: 1.08, healthy: 1.0, soft: 0.88, dead: 0.70 },
  // Liquidity haircut — slow movers tie up cash
  velocityHaircut: { fast: 1.0, medium: 0.95, slow: 0.85 },
  maxOfferUplift: 1.10, // max offer = recommended * this
};

function tierFor(price) {
  return OFFER_CONFIG.tiers.find(t => price <= t.max);
}

function computeOffer(card) {
  const mv = card.marketValue || 0;
  const tier = tierFor(mv);
  const demand = OFFER_CONFIG.demandMultiplier[card.demand] ?? 1.0;
  const velocity = OFFER_CONFIG.velocityHaircut[card.velocity] ?? 0.95;

  const baseOffer = mv * tier.buyPct * demand * velocity;
  const recommended = Math.max(0, baseOffer);
  const maximum = recommended * OFFER_CONFIG.maxOfferUplift;

  // Avoid logic — cards the store shouldn't buy
  let avoid = false;
  let avoidReason = "";
  if (mv < 1.5) { avoid = true; avoidReason = "Bulk — not worth handling"; }
  else if (card.demand === "dead") { avoid = true; avoidReason = "No local demand"; }
  else if (card.velocity === "slow" && mv < 10) { avoid = true; avoidReason = "Slow mover, low value"; }

  return {
    recommended: Math.round(recommended * 100) / 100,
    maximum: Math.round(maximum * 100) / 100,
    buyPct: tier.buyPct,
    tier: tier.label,
    avoid,
    avoidReason,
  };
}

// Estimate sell-through % and days-to-sell from card signals
function estimateSellThrough(cards) {
  const keep = cards.filter(c => !c.offer.avoid);
  if (keep.length === 0) return { sellThrough: 0, daysToSell: 0 };
  const demandScore = { hot: 95, healthy: 80, soft: 60, dead: 30 };
  const velocityDays = { fast: 21, medium: 45, slow: 90 };
  const avgSell = keep.reduce((s, c) => s + (demandScore[c.demand] ?? 65), 0) / keep.length;
  const avgDays = keep.reduce((s, c) => s + (velocityDays[c.velocity] ?? 45), 0) / keep.length;
  return { sellThrough: Math.round(avgSell), daysToSell: Math.round(avgDays) };
}

function gradeCollection(totalMV, totalOffer, sellThrough) {
  // Grade the DEAL quality for the store (margin headroom + liquidity)
  const margin = totalMV > 0 ? (totalMV - totalOffer) / totalMV : 0;
  const score = margin * 60 + (sellThrough / 100) * 40;
  if (score >= 50) return "A";
  if (score >= 44) return "A-";
  if (score >= 38) return "B+";
  if (score >= 32) return "B";
  if (score >= 26) return "C+";
  return "C";
}

const fmt = (n) => "$" + (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => "$" + Math.round(n ?? 0).toLocaleString();

// ── UI atoms ──
const C = {
  bg: "#0a0c0b", panel: "#101413", panel2: "#0c100f", border: "#1c2220",
  green: "#19c37d", greenDim: "#0d3d28", red: "#ff5c5c", redDim: "#3d0d0d",
  amber: "#f5a623", amberDim: "#3d2a00", text: "#e8ece9", dim: "#7a8580", faint: "#4a524e",
  blue: "#3b9ce8",
};

function Stat({ label, value, color, sub }) {
  return (
    <div style={{ flex: 1, minWidth: "100px" }}>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.faint, letterSpacing: "1.5px", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "20px", fontWeight: 700, color: color || C.text }}>{value}</div>
      {sub && <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", color: C.dim, marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

function DemandPill({ demand }) {
  const map = {
    hot: { c: C.green, t: "HOT" }, healthy: { c: C.blue, t: "HEALTHY" },
    soft: { c: C.amber, t: "SOFT" }, dead: { c: C.red, t: "DEAD" },
  };
  const d = map[demand] || map.healthy;
  return <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", color: d.c, background: `${d.c}18`, border: `1px solid ${d.c}44`, borderRadius: "3px", padding: "1px 5px", letterSpacing: "1px" }}>{d.t}</span>;
}

export default function VaultOSAcquisition() {
  const [stage, setStage] = useState("upload"); // upload | analyzing | results
  const [images, setImages] = useState([]);
  const [cards, setCards] = useState([]);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");
  const fileRef = useRef(null);

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []);
    const readers = files.map(file => new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res({ name: file.name, dataUrl: r.result, base64: r.result.split(",")[1], mediaType: file.type });
      r.readAsDataURL(file);
    }));
    Promise.all(readers).then(imgs => {
      setImages(prev => [...prev, ...imgs]);
      setError(null);
    });
  };

  const removeImage = (i) => setImages(prev => prev.filter((_, idx) => idx !== i));

  const analyze = async () => {
    if (images.length === 0) return;
    setStage("analyzing");
    setError(null);
    const allCards = [];

    try {
      for (let i = 0; i < images.length; i++) {
        setProgress(`Identifying cards in photo ${i + 1} of ${images.length}…`);
        const img = images[i];

        const systemPrompt = `You are the VaultOS Acquisition Engine, an expert at identifying trading cards, sports cards, and comics from photos for a local game/card store appraisal.

For the image, identify EVERY distinct card/item visible. For each, return realistic current market data based on your knowledge.

Respond with ONLY a valid JSON array (no markdown, no fences). Each element:
{
  "name": "full card name with set/year",
  "category": "pokemon" | "sports" | "mtg" | "comic" | "other",
  "condition": "raw" | "graded" | "sealed",
  "grade": "e.g. PSA 9 or null",
  "marketValue": <number, current eBay-sold avg in USD>,
  "demand": "hot" | "healthy" | "soft" | "dead",
  "velocity": "fast" | "medium" | "slow",
  "confidence": <0-100, how sure you are of the ID>,
  "notes": "brief appraisal note"
}

Be realistic and conservative on values — this drives real money offers. If you cannot identify an item, still include it with low confidence and best-guess value. Return [] only if truly nothing is visible.`;

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1500,
            system: systemPrompt,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: img.mediaType || "image/jpeg", data: img.base64 } },
                { type: "text", text: "Identify and appraise every card/item in this photo. Return the JSON array only." },
              ],
            }],
          }),
        });

        const data = await response.json();
        const raw = data.content?.find(b => b.type === "text")?.text || "[]";
        let parsed;
        try {
          parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
        } catch {
          parsed = [];
        }
        parsed.forEach(card => {
          allCards.push({ ...card, offer: computeOffer(card), sourceImage: i });
        });
      }

      if (allCards.length === 0) {
        setError("No cards identified. Try clearer, well-lit photos with cards laid out flat.");
        setStage("upload");
        return;
      }

      setCards(allCards);
      setStage("results");
    } catch (err) {
      setError(err.message || "Analysis failed. Try again.");
      setStage("upload");
    }
  };

  const reset = () => {
    setStage("upload"); setImages([]); setCards([]); setError(null); setProgress("");
  };

  // ── Aggregate math ──
  const keepCards = cards.filter(c => !c.offer.avoid);
  const avoidCards = cards.filter(c => c.offer.avoid);
  const totalRetail = keepCards.reduce((s, c) => s + (c.marketValue || 0), 0);
  const totalEbay = totalRetail * 0.9;
  const totalRecommended = keepCards.reduce((s, c) => s + c.offer.recommended, 0);
  const totalMax = keepCards.reduce((s, c) => s + c.offer.maximum, 0);
  const { sellThrough, daysToSell } = estimateSellThrough(cards);
  const grade = gradeCollection(totalRetail, totalRecommended, sellThrough);
  const projectedProfit = totalRetail - totalRecommended;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter', sans-serif", padding: "20px 16px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: "760px", margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "19px", fontWeight: 700, letterSpacing: "2px", color: "#fff" }}>VAULT<span style={{ color: C.green }}>OS</span></span>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.green, background: C.greenDim, border: `1px solid ${C.green}44`, borderRadius: "4px", padding: "2px 7px", letterSpacing: "1.5px" }}>ACQUISITION ENGINE</span>
            </div>
            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", color: C.dim, margin: "4px 0 0" }}>Photo → ID → Offer. Know what to pay before you spend a dollar.</p>
          </div>
          {stage === "results" && (
            <button onClick={reset} style={btn(C.border, C.dim)}>NEW INTAKE</button>
          )}
        </div>

        {/* ── UPLOAD STAGE ── */}
        {stage === "upload" && (
          <>
            <div
              onClick={() => fileRef.current?.click()}
              style={{ border: `2px dashed ${C.border}`, borderRadius: "12px", padding: "36px 20px", textAlign: "center", cursor: "pointer", background: C.panel2, marginBottom: "16px" }}
            >
              <div style={{ fontSize: "28px", marginBottom: "8px" }}>📸</div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "13px", color: C.text, letterSpacing: "1px", marginBottom: "4px" }}>TAP TO ADD PHOTOS</div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", color: C.dim }}>Lay cards flat, good lighting. Multiple photos OK.</div>
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: "none" }} />
            </div>

            {images.length > 0 && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: "8px", marginBottom: "16px" }}>
                  {images.map((img, i) => (
                    <div key={i} style={{ position: "relative", aspectRatio: "1", borderRadius: "8px", overflow: "hidden", border: `1px solid ${C.border}` }}>
                      <img src={img.dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button onClick={() => removeImage(i)} style={{ position: "absolute", top: "2px", right: "2px", width: "18px", height: "18px", borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.7)", color: "#fff", cursor: "pointer", fontSize: "11px", lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                </div>
                <button onClick={analyze} style={btn(C.green, "#000", true)}>
                  ANALYZE {images.length} PHOTO{images.length > 1 ? "S" : ""} →
                </button>
              </>
            )}

            {error && <div style={errBox()}>{error}</div>}

            <div style={{ marginTop: "20px", padding: "14px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.faint, letterSpacing: "1.5px", marginBottom: "8px" }}>HOW THE OFFER IS CALCULATED</div>
              <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", color: C.dim, lineHeight: 1.6, margin: 0 }}>
                Each card is identified and valued at eBay-sold market. The engine then applies a tiered buy-percentage (lower on cheap cards, higher on premium), adjusts for local demand and how fast it sells, and flags cards to avoid. You get a recommended and maximum offer — plus a deal grade.
              </p>
            </div>
          </>
        )}

        {/* ── ANALYZING STAGE ── */}
        {stage === "analyzing" && (
          <div style={{ padding: "48px 24px", textAlign: "center", background: C.panel, border: `1px solid ${C.border}`, borderRadius: "12px" }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "12px", color: C.green, letterSpacing: "2px", marginBottom: "12px", animation: "pulse 1.4s ease-in-out infinite" }}>SCANNING</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", color: C.text }}>{progress}</div>
            <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>
          </div>
        )}

        {/* ── RESULTS STAGE ── */}
        {stage === "results" && (
          <>
            {/* Hero offer card */}
            <div style={{ background: `linear-gradient(160deg, ${C.panel}, ${C.panel2})`, border: `1px solid ${C.green}33`, borderRadius: "14px", padding: "22px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "18px", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.faint, letterSpacing: "2px", marginBottom: "6px" }}>RECOMMENDED OFFER</div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "44px", fontWeight: 700, color: C.green, lineHeight: 1 }}>{fmt0(totalRecommended)}</div>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", color: C.dim, marginTop: "4px" }}>Max offer: <span style={{ color: C.text }}>{fmt0(totalMax)}</span></div>
                </div>
                <div style={{ textAlign: "center", background: C.bg, border: `2px solid ${gradeColor(grade)}`, borderRadius: "12px", padding: "10px 16px", minWidth: "72px" }}>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", color: C.faint, letterSpacing: "1.5px", marginBottom: "2px" }}>DEAL GRADE</div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "32px", fontWeight: 700, color: gradeColor(grade), lineHeight: 1 }}>{grade}</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", paddingTop: "16px", borderTop: `1px solid ${C.border}` }}>
                <Stat label="EST. RETAIL" value={fmt0(totalRetail)} />
                <Stat label="EST. EBAY" value={fmt0(totalEbay)} />
                <Stat label="SELL-THROUGH" value={`${sellThrough}%`} color={sellThrough >= 75 ? C.green : sellThrough >= 55 ? C.amber : C.red} />
                <Stat label="DAYS TO SELL" value={`~${daysToSell}`} />
                <Stat label="PROJ. PROFIT" value={fmt0(projectedProfit)} color={C.green} sub={`if sold at retail`} />
              </div>
            </div>

            {/* Summary chips */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
              <div style={chip(C.green)}>{keepCards.length} TO BUY</div>
              {avoidCards.length > 0 && <div style={chip(C.red)}>{avoidCards.length} TO AVOID</div>}
              <div style={chip(C.dim)}>{cards.length} ITEMS SCANNED</div>
            </div>

            {/* Card list — BUY */}
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", color: C.green, letterSpacing: "2px", marginBottom: "10px" }}>✓ RECOMMENDED TO BUY</div>
            {keepCards.map((card, i) => (
              <CardRow key={i} card={card} />
            ))}

            {/* Card list — AVOID */}
            {avoidCards.length > 0 && (
              <>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", color: C.red, letterSpacing: "2px", margin: "20px 0 10px" }}>✕ RECOMMENDED TO AVOID</div>
                {avoidCards.map((card, i) => (
                  <CardRow key={i} card={card} avoid />
                ))}
              </>
            )}

            {/* Disclaimer */}
            <div style={{ marginTop: "24px", fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.faint, letterSpacing: "0.5px", lineHeight: 1.6, textAlign: "center" }}>
              AI-ASSISTED APPRAISAL · VERIFY HIGH-VALUE IDS MANUALLY · OFFER LOGIC IS CONFIGURABLE PER STORE
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ── Card row ──
function CardRow({ card, avoid }) {
  const catColor = { pokemon: C.amber, sports: C.blue, mtg: "#a06fd6", comic: C.red, other: C.dim }[card.category] || C.dim;
  return (
    <div style={{ background: C.panel, border: `1px solid ${avoid ? C.redDim : C.border}`, borderRadius: "10px", padding: "12px 14px", marginBottom: "8px", opacity: avoid ? 0.7 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "180px" }}>
          <div style={{ display: "flex", gap: "6px", marginBottom: "4px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", color: catColor, letterSpacing: "1px", textTransform: "uppercase" }}>{card.category}</span>
            {card.grade && <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", color: C.text, background: C.bg, border: `1px solid ${C.border}`, borderRadius: "3px", padding: "1px 5px" }}>{card.grade}</span>}
            <DemandPill demand={card.demand} />
            {card.confidence < 70 && <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", color: C.amber }}>⚠ LOW CONFIDENCE</span>}
          </div>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{card.name}</div>
          {card.notes && <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", color: C.dim, marginTop: "3px", fontStyle: "italic" }}>{card.notes}</div>}
          {avoid && <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.red, marginTop: "4px" }}>AVOID: {card.offer.avoidReason}</div>}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.faint, letterSpacing: "1px" }}>MARKET</div>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "15px", color: C.text }}>{fmt(card.marketValue)}</div>
          {!avoid && (
            <>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.faint, letterSpacing: "1px", marginTop: "6px" }}>OFFER</div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "15px", fontWeight: 700, color: C.green }}>{fmt(card.offer.recommended)}</div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.dim }}>max {fmt(card.offer.maximum)}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Style helpers ──
function btn(bg, color, full) {
  return {
    fontFamily: "'Space Mono', monospace", fontSize: "12px", fontWeight: 700, letterSpacing: "1px",
    padding: full ? "14px" : "7px 14px", borderRadius: "8px", border: bg === C.border ? `1px solid ${C.border}` : "none",
    background: bg === C.border ? "transparent" : bg, color, cursor: "pointer", width: full ? "100%" : "auto",
  };
}
function chip(color) {
  return { fontFamily: "'Space Mono', monospace", fontSize: "10px", color, background: `${color}14`, border: `1px solid ${color}33`, borderRadius: "20px", padding: "5px 12px", letterSpacing: "1px" };
}
function errBox() {
  return { marginTop: "14px", background: C.redDim, border: `1px solid ${C.red}44`, borderRadius: "8px", padding: "12px", fontFamily: "'Space Mono', monospace", fontSize: "11px", color: C.red };
}
function gradeColor(g) {
  if (g.startsWith("A")) return C.green;
  if (g.startsWith("B")) return C.blue;
  return C.amber;
}
