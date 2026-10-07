import { useState, useRef } from "react";
import {
  aggregateIntake,
  gradeColor,
  runIntakePipeline,
} from "../lib/offerEngine.js";
import { priceConfidenceLabel } from "../lib/pricingService.js";
import { getAsset, formatCurrency } from "../data/mockCatalog.js";
import { isIOS, isMobile } from "../lib/device.js";
import MobileConnect from "../components/MobileConnect.jsx";

const fmt0 = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n ?? 0);

function DemandPill({ demand }) {
  const map = {
    hot: { cls: "demand-hot", label: "HOT" },
    healthy: { cls: "demand-healthy", label: "HEALTHY" },
    soft: { cls: "demand-soft", label: "SOFT" },
    dead: { cls: "demand-dead", label: "DEAD" },
  };
  const d = map[demand] || map.healthy;
  return <span className={`demand-pill ${d.cls}`}>{d.label}</span>;
}

function ConfidenceDot({ score, kind = "price" }) {
  const conf = priceConfidenceLabel(score ?? 0);
  return (
    <span className={`confidence-dot ${conf.className}`} title={kind === "price" ? "Price confidence" : "ID confidence"}>
      ● {conf.label}
    </span>
  );
}

function IntakeCardRow({ card, avoid, expanded, onToggle, onNavigate }) {
  const hasComps = card.comps?.length > 0;

  return (
    <div className={`intake-row ${avoid ? "intake-row-avoid" : ""}`}>
      <div className="intake-row-thumb">{card.image || "🃏"}</div>
      <div className="intake-row-body">
        <div className="intake-row-meta">
          <span className="intake-cat">{card.category}</span>
          {card.grade && <span className="intake-grade">{card.grade}</span>}
          {card.condition && <span className="intake-grade">{card.condition}</span>}
          <DemandPill demand={card.demand} />
          {card.priceConfidence != null && <ConfidenceDot score={card.priceConfidence} />}
          {card.idConfidence != null && card.idConfidence < 70 && (
            <span className="intake-low-conf">ID {card.idConfidence}%</span>
          )}
        </div>
        <div className="intake-row-name">{card.name}</div>
        {card.priceSource && (
          <div className="intake-price-source">src: {card.priceSource}</div>
        )}
        {card.notes && <div className="intake-row-notes">{card.notes}</div>}
        {avoid && (
          <div className="intake-avoid-reason">Avoid: {card.offer.avoidReason}</div>
        )}
        {hasComps && (
          <button type="button" className="intake-comps-toggle" onClick={onToggle}>
            {expanded ? "▼ Hide comps" : `▶ Show ${card.comps.length} sold comps`}
          </button>
        )}
        {expanded && hasComps && (
          <div className="intake-comps-panel">
            {card.priceLow != null && card.priceHigh != null && (
              <div className="intake-comps-range">
                Range {formatCurrency(card.priceLow)} – {formatCurrency(card.priceHigh)}
              </div>
            )}
            {card.comps.map((comp, ci) => (
              <div key={ci} className="intake-comp-row">
                <span className="intake-comp-title">
                  {comp.title} <span className="intake-comp-date">· {comp.date}</span>
                </span>
                <span className="intake-comp-price">{formatCurrency(comp.price)}</span>
              </div>
            ))}
          </div>
        )}
        {card.assetId && !avoid && (
          <button
            type="button"
            className="intake-link-btn"
            onClick={() => onNavigate("catalog", card.assetId)}
          >
            View in catalog →
          </button>
        )}
      </div>
      <div className="intake-row-price">
        <div className="intake-price-label">Market</div>
        <div>{formatCurrency(card.marketValue)}</div>
        {!avoid && (
          <>
            <div className="intake-price-label" style={{ marginTop: 8 }}>
              Offer
            </div>
            <div className="intake-offer-val">{formatCurrency(card.offer.recommended)}</div>
            <div className="intake-offer-max">max {formatCurrency(card.offer.maximum)}</div>
            <div className="intake-tier">{card.offer.tier} tier</div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AcquireView({ onNavigate }) {
  const [stage, setStage] = useState("upload");
  const [images, setImages] = useState([]);
  const [cards, setCards] = useState([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [expandedComps, setExpandedComps] = useState({});
  const libraryRef = useRef(null);
  const cameraRef = useRef(null);
  const videoRef = useRef(null);
  const desktopRef = useRef(null);
  const mobile = isMobile();
  const ios = isIOS();

  const toggleComps = (key) => setExpandedComps((p) => ({ ...p, [key]: !p[key] }));

  const ingestFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const readers = files.map(
      (file) =>
        new Promise((res, rej) => {
          const isVideo = file.type.startsWith("video/");
          const r = new FileReader();
          r.onload = () =>
            res({
              name: file.name,
              dataUrl: r.result,
              mediaType: isVideo ? "video" : "image",
            });
          r.onerror = () => rej(new Error("Could not read file"));
          r.readAsDataURL(file);
        })
    );
    Promise.all(readers)
      .then((items) => {
        setImages((prev) => [...prev, ...items]);
        setError(null);
      })
      .catch(() => setError("Could not read one or more photos or clips."));
  };

  const handleFiles = (e) => {
    ingestFiles(e.target.files);
    e.target.value = "";
  };

  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  const analyze = async () => {
    if (images.length === 0) return;
    setStage("analyzing");
    setCards([]);
    setError(null);
    setExpandedComps({});

    try {
      const priced = await runIntakePipeline(images.length, getAsset, setProgress);
      if (priced.length === 0) {
        setError("No cards identified. Try clearer, well-lit photos with cards laid flat.");
        setStage("upload");
        return;
      }
      setCards(priced);
      setStage("results");
      setProgress("");
    } catch {
      setError("Analysis failed. Try again.");
      setStage("upload");
    }
  };

  const reset = () => {
    setStage("upload");
    setImages([]);
    setCards([]);
    setProgress("");
    setError(null);
    setExpandedComps({});
  };

  const agg = stage === "results" ? aggregateIntake(cards) : null;
  const priceConfColor =
    (agg?.avgPriceConfidence ?? 0) >= 70
      ? "var(--green)"
      : (agg?.avgPriceConfidence ?? 0) >= 45
        ? "var(--gold)"
        : "var(--red)";

  return (
    <>
      <div className="acquire-header">
        <div>
          <h2 className="page-title">Acquisition Engine</h2>
          <p className="page-sub">Real scans. Real comps. Real offers.</p>
        </div>
        {stage === "results" && (
          <button type="button" className="btn btn-ghost" onClick={reset}>
            New intake
          </button>
        )}
      </div>

      {stage === "upload" && (
        <>
          <MobileConnect />

          {mobile ? (
            <div className="acquire-mobile-upload">
              <p className="acquire-mobile-lead">
                {ios ? "Add photos from your iPhone" : "Add photos from your device"}
              </p>
              <div className="acquire-mobile-actions">
                <button
                  type="button"
                  className="btn btn-primary acquire-mobile-btn"
                  onClick={() => libraryRef.current?.click()}
                >
                  <span className="acquire-mobile-btn-icon">🖼</span>
                  Photo Library
                </button>
                <button
                  type="button"
                  className="btn btn-ghost acquire-mobile-btn"
                  onClick={() => cameraRef.current?.click()}
                >
                  <span className="acquire-mobile-btn-icon">📷</span>
                  Take Photo
                </button>
                <button
                  type="button"
                  className="btn btn-ghost acquire-mobile-btn"
                  onClick={() => videoRef.current?.click()}
                >
                  <span className="acquire-mobile-btn-icon">🎬</span>
                  Record Clip
                </button>
              </div>
              <p className="acquire-dropzone-sub">
                Supports HEIC/JPEG photos and MOV/MP4 clips from Camera Roll. Lay cards flat with good lighting.
              </p>
              <input
                ref={libraryRef}
                type="file"
                accept="image/*,.heic,.heif,video/*,.mov,.mp4"
                multiple
                onChange={handleFiles}
                hidden
              />
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFiles}
                hidden
              />
              <input
                ref={videoRef}
                type="file"
                accept="video/*,.mov,.mp4"
                capture="environment"
                onChange={handleFiles}
                hidden
              />
            </div>
          ) : (
            <div
              className="acquire-dropzone"
              onClick={() => desktopRef.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && desktopRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <div className="acquire-dropzone-icon">📸</div>
              <p className="acquire-dropzone-title">Tap to add photos</p>
              <p className="acquire-dropzone-sub">
                Lay cards flat, good lighting. Photos and short clips OK — or scan the QR for iPhone upload.
              </p>
              <input
                ref={desktopRef}
                type="file"
                accept="image/*,.heic,.heif,video/*,.mov,.mp4"
                multiple
                onChange={handleFiles}
                hidden
              />
            </div>
          )}

          {images.length > 0 && (
            <>
              <div className="acquire-thumbs">
                {images.map((img, i) => (
                  <div key={i} className="acquire-thumb">
                    {img.mediaType === "video" ? (
                      <video src={img.dataUrl} muted playsInline className="acquire-thumb-media" />
                    ) : (
                      <img src={img.dataUrl} alt="" />
                    )}
                    {img.mediaType === "video" && <span className="acquire-thumb-badge">CLIP</span>}
                    <button type="button" className="acquire-thumb-remove" onClick={() => removeImage(i)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-primary acquire-analyze-btn" onClick={analyze}>
                Scan &amp; price {images.length} file{images.length > 1 ? "s" : ""} →
              </button>
            </>
          )}

          {error && <div className="acquire-error">{error}</div>}

          <div className="card acquire-pipeline-card">
            <p className="card-title">Two-stage pipeline</p>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", margin: 0, lineHeight: 1.65 }}>
              <strong style={{ color: "var(--text)" }}>1 · Identify</strong> — match each item to the IQVault catalog (set, year, grade, printing).<br />
              <strong style={{ color: "var(--text)" }}>2 · Price</strong> — ground each ID in{" "}
              <strong style={{ color: "var(--text)" }}>recent sold comps</strong>, then the offer engine applies your buy percentages. Tap any card to verify its comps.
            </p>
          </div>
        </>
      )}

      {stage === "analyzing" && (
        <div className="card acquire-analyzing">
          <div className="acquire-scan-label">Working</div>
          <p>{progress}</p>
          <p className="acquire-analyzing-sub">Pricing pulls sold comps — worth the wait.</p>
          <div className="acquire-progress-bar">
            <div className="acquire-progress-fill" />
          </div>
        </div>
      )}

      {stage === "results" && agg && (
        <>
          <div className="card card-gold acquire-hero">
            <div className="acquire-hero-top">
              <div>
                <p className="card-title">Recommended offer</p>
                <p className="acquire-hero-offer">{fmt0(agg.totalRecommended)}</p>
                <p className="acquire-hero-max">
                  Max offer: <strong>{fmt0(agg.totalMax)}</strong>
                </p>
              </div>
              <div className="acquire-hero-side">
                <div className="acquire-grade-box" style={{ borderColor: gradeColor(agg.dealGrade) }}>
                  <p className="card-title">Deal grade</p>
                  <p className="acquire-grade" style={{ color: gradeColor(agg.dealGrade) }}>
                    {agg.dealGrade}
                  </p>
                </div>
                <div className="acquire-grade-box" style={{ borderColor: priceConfColor }}>
                  <p className="card-title">Price confidence</p>
                  <p className="acquire-grade" style={{ color: priceConfColor, fontSize: "1.75rem" }}>
                    {agg.avgPriceConfidence}%
                  </p>
                  <p className="acquire-stat-sub">grounded in sold comps</p>
                </div>
              </div>
            </div>
            <div className="acquire-stats">
              <div className="acquire-stat">
                <span className="card-title">Est. retail</span>
                <strong>{fmt0(agg.totalRetail)}</strong>
              </div>
              <div className="acquire-stat">
                <span className="card-title">To buy</span>
                <strong style={{ color: "var(--green)" }}>{agg.keep.length}</strong>
              </div>
              <div className="acquire-stat">
                <span className="card-title">To avoid</span>
                <strong style={{ color: agg.avoid.length ? "var(--red)" : "var(--text-muted)" }}>
                  {agg.avoid.length}
                </strong>
              </div>
              <div className="acquire-stat">
                <span className="card-title">Sell-through</span>
                <strong
                  style={{
                    color:
                      agg.sellThrough >= 75
                        ? "var(--green)"
                        : agg.sellThrough >= 55
                          ? "var(--gold)"
                          : "var(--red)",
                  }}
                >
                  {agg.sellThrough}%
                </strong>
              </div>
              <div className="acquire-stat">
                <span className="card-title">Proj. profit</span>
                <strong style={{ color: "var(--green)" }}>{fmt0(agg.projectedProfit)}</strong>
                <span className="acquire-stat-sub">at retail</span>
              </div>
            </div>
          </div>

          <div className="acquire-chips">
            <span className="acquire-chip acquire-chip-buy">{agg.keep.length} to buy</span>
            {agg.avoid.length > 0 && (
              <span className="acquire-chip acquire-chip-avoid">{agg.avoid.length} to avoid</span>
            )}
            <span className="acquire-chip">{cards.length} items scanned</span>
          </div>

          <h3 className="acquire-section-title acquire-section-buy">Recommended to buy</h3>
          {agg.keep.map((card) => (
            <IntakeCardRow
              key={card.assetId}
              card={card}
              expanded={expandedComps[card.assetId]}
              onToggle={() => toggleComps(card.assetId)}
              onNavigate={onNavigate}
            />
          ))}

          {agg.avoid.length > 0 && (
            <>
              <h3 className="acquire-section-title acquire-section-avoid">Recommended to avoid</h3>
              {agg.avoid.map((card) => {
                const key = `avoid-${card.assetId}`;
                return (
                  <IntakeCardRow
                    key={key}
                    card={card}
                    avoid
                    expanded={expandedComps[key]}
                    onToggle={() => toggleComps(key)}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </>
          )}

          <p className="acquire-disclaimer">
            Demo: catalog-backed ID + mock sold comps · each photo or clip counts as one intake source · production extracts frames from clips · tap any card to see comps
          </p>
        </>
      )}
    </>
  );
}
