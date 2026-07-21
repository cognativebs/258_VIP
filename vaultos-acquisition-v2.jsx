import { useState, useRef } from "react";

// VaultOS — Acquisition Engine v2 (reference prototype)
// MERGED INTO: demo/src/lib/offerEngine.js + demo/src/lib/pricingService.js + demo/src/views/AcquireView.jsx
// Key v2 ideas: two-stage Identify→Price(comps)→Offer pipeline, getPricing() swap point, expandable sold comps.

// ─── OFFER ENGINE — the store's IP. Configurable per store. ───
const OFFER_CONFIG = {
  tiers: [
    { max: 5,    buyPct: 0.30, label: "Bulk" },
    { max: 20,   buyPct: 0.45, label: "Low" },
    { max: 75,   buyPct: 0.55, label: "Mid" },
    { max: 300,  buyPct: 0.62, label: "High" },
    { max: 1000, buyPct: 0.68, label: "Premium" },
    { max: Infinity, buyPct: 0.72, label: "Grail" },
  ],
  demandMultiplier: { hot: 1.08, healthy: 1.0, soft: 0.88, dead: 0.70 },
  velocityHaircut: { fast: 1.0, medium: 0.95, slow: 0.85 },
  maxOfferUplift: 1.10,
};

const tierFor = (price) => OFFER_CONFIG.tiers.find(t => price <= t.max);

function computeOffer(card) {
  const mv = card.marketValue || 0;
  const tier = tierFor(mv);
  const demand = OFFER_CONFIG.demandMultiplier[card.demand] ?? 1.0;
  const velocity = OFFER_CONFIG.velocityHaircut[card.velocity] ?? 0.95;
  const recommended = Math.max(0, mv * tier.buyPct * demand * velocity);
  const maximum = recommended * OFFER_CONFIG.maxOfferUplift;

  let avoid = false, avoidReason = "";
  if (mv < 1.5) { avoid = true; avoidReason = "Bulk — not worth handling"; }
  else if (card.demand === "dead") { avoid = true; avoidReason = "No local demand"; }
  else if (card.velocity === "slow" && mv < 10) { avoid = true; avoidReason = "Slow mover, low value"; }

  return {
    recommended: Math.round(recommended * 100) / 100,
    maximum: Math.round(maximum * 100) / 100,
    tier: tier.label, avoid, avoidReason,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PRICING — THE SWAP POINT
// ─────────────────────────────────────────────────────────────────────────────
// getPricing() takes an identified card and returns real market data + comps.
// TODAY: web-search grounded via Claude API with web_search tool.
// LATER: replace the body with an eBay Marketplace Insights API call.
//        The return shape is the contract — keep it identical and nothing
//        downstream changes. That's the whole point of this seam.
//
// Return contract:
//   { marketValue: number, low: number, high: number,
//     comps: [{ price, date, title }], source: string, confidence: number }
// ═════════════════════════════════════════════════════════════════════════════
async function getPricing(card) {
  const query = [card.year, card.name, card.grade].filter(Boolean).join(" ");

  const systemPrompt = `You are the VaultOS pricing service. You find REAL recent sold prices for a trading card / collectible using web search of completed sales (eBay sold listings, auction results, price guides).

Search for actual recent SOLD comps for the card given. Then respond with ONLY a valid JSON object (no markdown, no fences):
{
  "marketValue": <number, your best current market value from real sold comps>,
  "low": <number, low end of recent sales>,
  "high": <number, high end of recent sales>,
  "comps": [ { "price": <number>, "date": "<approx date/recency>", "title": "<short comp description>" } ],
  "source": "<where the comps came from, e.g. 'eBay sold, last 30d'>",
  "confidence": <0-100, how confident given comp quality/quantity>
}

Use 3-6 real comps if available. Be conservative and realistic — this drives real money offers. If the card is soft/illiquid and comps are thin, say so via low confidence and a wide low/high range.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: "user", content: `Find real recent sold prices for: ${query}. Category: ${card.category}. Return the JSON only.` }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });
    const data = await response.json();
    // Pull text blocks (web_search responses interleave tool_use + text)
    const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "";
    const match = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no json");
    const parsed = JSON.parse(match[0]);
    return {
      marketValue: parsed.marketValue ?? card.marketValue ?? 0,
      low: parsed.low, high: parsed.high,
      comps: Array.isArray(parsed.comps) ? parsed.comps.slice(0, 6) : [],
      source: parsed.source || "web comps",
      confidence: parsed.confidence ?? 50,
    };
  } catch {
    // Fallback: AI's own estimate from ID stage, flagged as unverified
    return {
      marketValue: card.marketValue ?? 0, low: null, high: null,
      comps: [], source: "estimate (no comps found)", confidence: 30,
    };
  }
}

const fmt = (n) => "$" + (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => "$" + Math.round(n ?? 0).toLocaleString();

const C = {
  bg: "#0a0c0b", panel: "#101413", panel2: "#0c100f", border: "#1c2220",
  green: "#19c37d", greenDim: "#0d3d28", red: "#ff5c5c", redDim: "#3d0d0d",
  amber: "#f5a623", amberDim: "#3d2a00", text: "#e8ece9", dim: "#7a8580",
  faint: "#4a524e", blue: "#3b9ce8", purple: "#a06fd6",
};

function Stat({ label, value, color, sub }) {
  return (
    <div style={{ flex: 1, minWidth: "96px" }}>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.faint, letterSpacing: "1.5px", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "19px", fontWeight: 700, color: color || C.text }}>{value}</div>
      {sub && <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", color: C.dim, marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

function DemandPill({ demand }) {
  const map = { hot: [C.green, "HOT"], healthy: [C.blue, "HEALTHY"], soft: [C.amber, "SOFT"], dead: [C.red, "DEAD"] };
  const [c, t] = map[demand] || map.healthy;
  return <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", color: c, background: `${c}18`, border: `1px solid ${c}44`, borderRadius: "3px", padding: "1px 5px", letterSpacing: "1px" }}>{t}</span>;
}

function ConfidenceDot({ score }) {
  const c = score >= 70 ? C.green : score >= 45 ? C.amber : C.red;
  const label = score >= 70 ? "VERIFIED" : score >= 45 ? "MODERATE" : "LOW CONF";
  return <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", color: c, letterSpacing: "1px" }}>● {label}</span>;
}

export default function VaultOSAcquisition() {
  const [stage, setStage] = useState("upload");
  const [images, setImages] = useState([]);
  const [cards, setCards] = useState([]);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");
  const [expandedComps, setExpandedComps] = useState({});
  const fileRef = useRef(null);

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []);
    Promise.all(files.map(file => new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res({ name: file.name, dataUrl: r.result, base64: r.result.split(",")[1], mediaType: file.type });
      r.readAsDataURL(file);
    }))).then(imgs => { setImages(prev => [...prev, ...imgs]); setError(null); });
  };

  const removeImage = (i) => setImages(prev => prev.filter((_, idx) => idx !== i));

  const analyze = async () => {
    if (images.length === 0) return;
    setStage("analyzing"); setError(null);
    const identified = [];

    try {
      // ─── STAGE 1: IDENTIFY every card in every photo ───
      for (let i = 0; i < images.length; i++) {
        setProgress(`Identifying cards — photo ${i + 1} of ${images.length}…`);
        const img = images[i];
        const systemPrompt = `You are the VaultOS Acquisition Engine identifying trading cards/comics from a photo for store appraisal.

Identify EVERY distinct item visible. Respond with ONLY a valid JSON array (no markdown):
[{
  "name": "full card name with set/year",
  "category": "pokemon"|"sports"|"mtg"|"comic"|"other",
  "condition": "raw"|"graded"|"sealed",
  "grade": "e.g. PSA 9 or null",
  "marketValue": <rough estimate, refined later by pricing service>,
  "demand": "hot"|"healthy"|"soft"|"dead",
  "velocity": "fast"|"medium"|"slow",
  "confidence": <0-100 ID confidence>,
  "notes": "brief note"
}]
Return [] only if nothing is visible. Be precise on set/year/grade — the pricing service depends on an accurate name string.`;

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1500,
            system: systemPrompt,
            messages: [{ role: "user", content: [
              { type: "image", source: { type: "base64", media_type: img.mediaType || "image/jpeg", data: img.base64 } },
              { type: "text", text: "Identify and appraise every item. JSON array only." },
            ] }],
          }),
        });
        const data = await response.json();
        const raw = data.content?.find(b => b.type === "text")?.text || "[]";
        let parsed;
        try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch { parsed = []; }
        parsed.forEach(c => identified.push({ ...c, sourceImage: i }));
      }

      if (identified.length === 0) {
        setError("No cards identified. Try clearer, well-lit photos with cards laid flat.");
        setStage("upload"); return;
      }

      // ─── STAGE 2: REAL PRICING for each identified card (web-search grounded) ───
      const priced = [];
      for (let j = 0; j < identified.length; j++) {
        setProgress(`Pricing ${j + 1} of ${identified.length}: ${identified[j].name.slice(0, 40)}…`);
        const pricing = await getPricing(identified[j]);
        const merged = {
          ...identified[j],
          marketValue: pricing.marketValue,
          priceLow: pricing.low, priceHigh: pricing.high,
          comps: pricing.comps, priceSource: pricing.source,
          priceConfidence: pricing.confidence,
        };
        merged.offer = computeOffer(merged);
        priced.push(merged);
      }

      setCards(priced);
      setStage("results");
    } catch (err) {
      setError(err.message || "Analysis failed. Try again.");
      setStage("upload");
    }
  };

  const reset = () => { setStage("upload"); setImages([]); setCards([]); setError(null); setProgress(""); setExpandedComps({}); };
  const toggleComps = (i) => setExpandedComps(p => ({ ...p, [i]: !p[i] }));

  const keep = cards.filter(c => !c.offer.avoid);
  const avoid = cards.filter(c => c.offer.avoid);
  const totalRetail = keep.reduce((s, c) => s + (c.marketValue || 0), 0);
  const totalRec = keep.reduce((s, c) => s + c.offer.recommended, 0);
  const totalMax = keep.reduce((s, c) => s + c.offer.maximum, 0);
  const profit = totalRetail - totalRec;
  const avgConf = keep.length ? Math.round(keep.reduce((s, c) => s + (c.priceConfidence || 0), 0) / keep.length) : 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter', sans-serif", padding: "20px 16px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: "760px", margin: "0 auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "19px", fontWeight: 700, letterSpacing: "2px", color: "#fff" }}>VAULT<span style={{ color: C.green }}>OS</span></span>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.green, background: C.greenDim, border: `1px solid ${C.green}44`, borderRadius: "4px", padding: "2px 7px", letterSpacing: "1.5px" }}>ACQUISITION ENGINE</span>
            </div>
            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", color: C.dim, margin: "4px 0 0" }}>Real scans. Real comps. Real offers.</p>
          </div>
          {stage === "results" && <button onClick={reset} style={btn(C.border, C.dim)}>NEW INTAKE</button>}
        </div>

        {/* UPLOAD */}
        {stage === "upload" && (
          <>
            <div onClick={() => fileRef.current?.click()} style={{ border: `2px dashed ${C.border}`, borderRadius: "12px", padding: "36px 20px", textAlign: "center", cursor: "pointer", background: C.panel2, marginBottom: "16px" }}>
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
                <button onClick={analyze} style={btn(C.green, "#000", true)}>SCAN & PRICE {images.length} PHOTO{images.length > 1 ? "S" : ""} →</button>
              </>
            )}
            {error && <div style={errBox()}>{error}</div>}
            <div style={{ marginTop: "20px", padding: "14px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.faint, letterSpacing: "1.5px", marginBottom: "8px" }}>TWO-STAGE PIPELINE</div>
              <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", color: C.dim, lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: C.text }}>1 · Identify</strong> — AI reads each card, set, year, and grade from the photo.<br />
                <strong style={{ color: C.text }}>2 · Price</strong> — each ID is grounded in <strong style={{ color: C.text }}>real recent sold comps</strong> via live web search, then the offer engine applies your buy percentages. Every price shows its comps so you can verify.
              </p>
            </div>
          </>
        )}

        {/* ANALYZING */}
        {stage === "analyzing" && (
          <div style={{ padding: "48px 24px", textAlign: "center", background: C.panel, border: `1px solid ${C.border}`, borderRadius: "12px" }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "12px", color: C.green, letterSpacing: "2px", marginBottom: "12px", animation: "pulse 1.4s ease-in-out infinite" }}>WORKING</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", color: C.text }}>{progress}</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", color: C.dim, marginTop: "8px" }}>Pricing pulls live sold comps — worth the wait.</div>
            <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>
          </div>
        )}

        {/* RESULTS */}
        {stage === "results" && (
          <>
            <div style={{ background: `linear-gradient(160deg, ${C.panel}, ${C.panel2})`, border: `1px solid ${C.green}33`, borderRadius: "14px", padding: "22px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "18px", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.faint, letterSpacing: "2px", marginBottom: "6px" }}>RECOMMENDED OFFER</div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "44px", fontWeight: 700, color: C.green, lineHeight: 1 }}>{fmt0(totalRec)}</div>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", color: C.dim, marginTop: "4px" }}>Max offer: <span style={{ color: C.text }}>{fmt0(totalMax)}</span></div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.faint, letterSpacing: "1.5px", marginBottom: "4px" }}>PRICE CONFIDENCE</div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "28px", fontWeight: 700, color: avgConf >= 70 ? C.green : avgConf >= 45 ? C.amber : C.red }}>{avgConf}%</div>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", color: C.dim }}>grounded in sold comps</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", paddingTop: "16px", borderTop: `1px solid ${C.border}` }}>
                <Stat label="EST. RETAIL" value={fmt0(totalRetail)} />
                <Stat label="TO BUY" value={keep.length} color={C.green} />
                <Stat label="TO AVOID" value={avoid.length} color={avoid.length ? C.red : C.dim} />
                <Stat label="PROJ. PROFIT" value={fmt0(profit)} color={C.green} sub="at retail" />
              </div>
            </div>

            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", color: C.green, letterSpacing: "2px", marginBottom: "10px" }}>✓ RECOMMENDED TO BUY</div>
            {keep.map((card, i) => <CardRow key={i} card={card} idx={i} expanded={expandedComps[i]} onToggle={() => toggleComps(i)} />)}

            {avoid.length > 0 && (
              <>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", color: C.red, letterSpacing: "2px", margin: "20px 0 10px" }}>✕ RECOMMENDED TO AVOID</div>
                {avoid.map((card, i) => <CardRow key={`a${i}`} card={card} idx={`a${i}`} avoid expanded={expandedComps[`a${i}`]} onToggle={() => toggleComps(`a${i}`)} />)}
              </>
            )}

            <div style={{ marginTop: "24px", fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.faint, letterSpacing: "0.5px", lineHeight: 1.6, textAlign: "center" }}>
              PRICES FROM LIVE WEB COMPS · TAP ANY CARD TO SEE ITS COMPS · VERIFY HIGH-VALUE IDS BY EYE
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CardRow({ card, avoid, expanded, onToggle }) {
  const catColor = { pokemon: C.amber, sports: C.blue, mtg: C.purple, comic: C.red, other: C.dim }[card.category] || C.dim;
  const hasComps = card.comps && card.comps.length > 0;
  return (
    <div style={{ background: C.panel, border: `1px solid ${avoid ? C.redDim : C.border}`, borderRadius: "10px", padding: "12px 14px", marginBottom: "8px", opacity: avoid ? 0.72 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "180px" }}>
          <div style={{ display: "flex", gap: "6px", marginBottom: "4px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", color: catColor, letterSpacing: "1px", textTransform: "uppercase" }}>{card.category}</span>
            {card.grade && <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", color: C.text, background: C.bg, border: `1px solid ${C.border}`, borderRadius: "3px", padding: "1px 5px" }}>{card.grade}</span>}
            <DemandPill demand={card.demand} />
            {card.priceConfidence != null && <ConfidenceDot score={card.priceConfidence} />}
          </div>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{card.name}</div>
          {card.priceSource && <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.dim, marginTop: "3px" }}>src: {card.priceSource}</div>}
          {avoid && <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.red, marginTop: "4px" }}>AVOID: {card.offer.avoidReason}</div>}
          {hasComps && (
            <button onClick={onToggle} style={{ marginTop: "6px", fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.blue, background: "none", border: "none", cursor: "pointer", padding: 0, letterSpacing: "0.5px" }}>
              {expanded ? "▼ HIDE COMPS" : `▶ SHOW ${card.comps.length} SOLD COMPS`}
            </button>
          )}
          {expanded && hasComps && (
            <div style={{ marginTop: "8px", background: C.bg, borderRadius: "6px", padding: "8px 10px" }}>
              {card.priceLow != null && (
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", color: C.dim, marginBottom: "6px" }}>
                  RANGE {fmt(card.priceLow)} – {fmt(card.priceHigh)}
                </div>
              )}
              {card.comps.map((comp, ci) => (
                <div key={ci} style={{ display: "flex", justifyContent: "space-between", gap: "8px", padding: "3px 0", borderBottom: ci < card.comps.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", color: C.dim, flex: 1 }}>{comp.title} <span style={{ color: C.faint }}>· {comp.date}</span></span>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", color: C.green }}>{fmt(comp.price)}</span>
                </div>
              ))}
            </div>
          )}
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

function btn(bg, color, full) {
  return { fontFamily: "'Space Mono', monospace", fontSize: "12px", fontWeight: 700, letterSpacing: "1px", padding: full ? "14px" : "7px 14px", borderRadius: "8px", border: bg === C.border ? `1px solid ${C.border}` : "none", background: bg === C.border ? "transparent" : bg, color, cursor: "pointer", width: full ? "100%" : "auto" };
}
function errBox() {
  return { marginTop: "14px", background: C.redDim, border: `1px solid ${C.red}44`, borderRadius: "8px", padding: "12px", fontFamily: "'Space Mono', monospace", fontSize: "11px", color: C.red };
}
