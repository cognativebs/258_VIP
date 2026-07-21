import { useEffect, useMemo, useState } from "react";
import {
  COLLECTION_PILLARS,
  RECOMMENDATIONS,
  SELL_PRIORITIES,
  SLAB_STATUSES,
  comicLabel,
  formatCell,
  fmtMoney,
  pillarShort,
  priorityClass,
  recClass,
  scoreClass,
} from "../../lib/comicEngine.js";

const EDITABLE_KEYS = [
  "Collection Pillar",
  "Recommendation",
  "Sell Priority",
  "Location",
  "Quantity",
  "Current Price",
  "Museum Score",
  "Investment Score",
  "Liquidity Score",
  "Slab Status",
  "Assumed Grade",
  "Grade Rating",
  "Verification Notes",
  "Upgrade Candidate",
  "Needs Grading",
  "Needs Photo",
  "Needs Verification",
  "Value Locked",
];

const YES_NO_KEYS = new Set([
  "Upgrade Candidate",
  "Needs Grading",
  "Needs Photo",
  "Needs Verification",
  "Value Locked",
]);

function ScoreBar({ label, value, max = 100 }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="bb-score-row">
      <span className="bb-score-label">{label}</span>
      <div className="bb-score-track">
        <div className={`bb-score-fill ${scoreClass(value)}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="bb-score-num">{Math.round(value)}</span>
    </div>
  );
}

function draftFromComic(comic) {
  const draft = {};
  for (const key of EDITABLE_KEYS) {
    draft[key] = comic[key] ?? (YES_NO_KEYS.has(key) ? "No" : "");
  }
  return draft;
}

function patchFromDraft(original, draft) {
  const patch = {};
  for (const key of EDITABLE_KEYS) {
    const before = original[key] ?? (YES_NO_KEYS.has(key) ? "No" : "");
    const after = draft[key];
    if (String(before) !== String(after)) {
      patch[key] = after;
    }
  }
  return patch;
}

export default function ComicInspectorPanel({
  comic,
  meta,
  filteredCount,
  pillarOptions,
  locationOptions,
  onSave,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveOk, setSaveOk] = useState(false);

  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setSaveError(null);
    setSaveOk(false);
  }, [comic?.id]);

  const pillars = useMemo(() => {
    const fromMeta = (pillarOptions ?? meta?.pillars ?? []).map((p) => p.name);
    return [...new Set([...COLLECTION_PILLARS, ...fromMeta])];
  }, [pillarOptions, meta?.pillars]);

  const locations = useMemo(() => {
    const fromMeta = (locationOptions ?? meta?.topLocations ?? [])
      .map((l) => l.name)
      .filter((n) => n && n !== "Unassigned");
    const cur = comic?.Location;
    return [...new Set([...(cur ? [cur] : []), ...fromMeta])];
  }, [locationOptions, meta?.topLocations, comic?.Location]);

  const startEdit = () => {
    if (!comic) return;
    setDraft(draftFromComic(comic));
    setEditing(true);
    setSaveError(null);
    setSaveOk(false);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(null);
    setSaveError(null);
  };

  const setField = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaveOk(false);
  };

  const handleSave = async () => {
    if (!comic || !draft) return;
    const patch = patchFromDraft(comic, draft);
    if (!Object.keys(patch).length) {
      setEditing(false);
      setDraft(null);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(comic.id, patch);
      setEditing(false);
      setDraft(null);
      setSaveOk(true);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!comic) {
    return (
      <div className="bb-detail bb-detail-empty">
        <div className="bb-panel-head">INSPECTOR</div>
        <div className="bb-detail-body">
          <p className="bb-detail-hint-lg">
            Click any row to inspect cover, scores, and intelligence flags.
          </p>
          <div className="bb-stat-block">
            <span className="bb-stat-label">Filtered set</span>
            <span className="bb-stat-val">{filteredCount?.toLocaleString()} books</span>
          </div>
          <div className="bb-stat-block">
            <span className="bb-stat-label">Full vault</span>
            <span className="bb-stat-val">{meta?.recordCount?.toLocaleString()} books</span>
          </div>
          <div className="bb-stat-block">
            <span className="bb-stat-label">Vault value</span>
            <span className="bb-stat-val bb-orange">{fmtMoney(meta?.totalValue)}</span>
          </div>
        </div>
      </div>
    );
  }

  const d = editing ? draft : comic;

  return (
    <div className="bb-detail">
      <div className="bb-panel-head bb-inspector-head">
        <span>{editing ? "EDIT HOLDING" : "ISSUE DETAIL"}</span>
        <div className="bb-inspector-actions">
          {!editing ? (
            <button type="button" className="bb-btn bb-btn-ghost bb-btn-sm" onClick={startEdit}>
              Edit
            </button>
          ) : (
            <>
              <button type="button" className="bb-btn bb-btn-ghost bb-btn-sm" onClick={cancelEdit} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="bb-btn bb-btn-sm bb-btn-save" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save to DB"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="bb-detail-body">
        {saveError && <p className="bb-inspector-error">{saveError}</p>}
        {saveOk && !editing && <p className="bb-inspector-ok">Saved to PostgreSQL</p>}

        {comic["Cover Image URL"] && !editing && (
          <div className="bb-cover-wrap">
            <img src={comic["Cover Image URL"]} alt="" className="bb-cover" loading="lazy" />
          </div>
        )}

        <h3 className="bb-detail-title">{comicLabel(comic)}</h3>
        {comic.Title && <p className="bb-detail-sub">{comic.Title}</p>}
        {comic["Edition / Variant"] && (
          <p className="bb-detail-variant">{comic["Edition / Variant"]}</p>
        )}

        {editing ? (
          <div className="bb-inspector-form">
            <label className="bb-inspector-field">
              <span>Pillar</span>
              <select
                className="bb-input bb-input-full"
                value={d["Collection Pillar"]}
                onChange={(e) => setField("Collection Pillar", e.target.value)}
              >
                {pillars.map((p) => (
                  <option key={p} value={p}>{pillarShort(p)}</option>
                ))}
              </select>
            </label>

            <label className="bb-inspector-field">
              <span>Recommendation</span>
              <select
                className="bb-input bb-input-full"
                value={d.Recommendation}
                onChange={(e) => setField("Recommendation", e.target.value)}
              >
                {RECOMMENDATIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>

            <label className="bb-inspector-field">
              <span>Sell priority</span>
              <select
                className="bb-input bb-input-full"
                value={d["Sell Priority"]}
                onChange={(e) => setField("Sell Priority", e.target.value)}
              >
                {SELL_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>

            <div className="bb-inspector-row">
              <label className="bb-inspector-field">
                <span>Value $</span>
                <input
                  type="number"
                  step="0.01"
                  className="bb-input bb-input-full"
                  value={d["Current Price"]}
                  onChange={(e) => setField("Current Price", e.target.value === "" ? "" : Number(e.target.value))}
                />
              </label>
              <label className="bb-inspector-field">
                <span>Qty</span>
                <input
                  type="number"
                  min={1}
                  className="bb-input bb-input-full"
                  value={d.Quantity}
                  onChange={(e) => setField("Quantity", e.target.value === "" ? "" : Number(e.target.value))}
                />
              </label>
            </div>

            <div className="bb-inspector-row">
              <label className="bb-inspector-field">
                <span>MUS</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="bb-input bb-input-full"
                  value={d["Museum Score"]}
                  onChange={(e) => setField("Museum Score", Number(e.target.value))}
                />
              </label>
              <label className="bb-inspector-field">
                <span>INV</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="bb-input bb-input-full"
                  value={d["Investment Score"]}
                  onChange={(e) => setField("Investment Score", Number(e.target.value))}
                />
              </label>
              <label className="bb-inspector-field">
                <span>LIQ</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="bb-input bb-input-full"
                  value={d["Liquidity Score"]}
                  onChange={(e) => setField("Liquidity Score", Number(e.target.value))}
                />
              </label>
            </div>

            <label className="bb-inspector-field">
              <span>Location</span>
              <input
                type="text"
                className="bb-input bb-input-full"
                list="bb-location-options"
                value={d.Location}
                onChange={(e) => setField("Location", e.target.value)}
              />
              <datalist id="bb-location-options">
                {locations.map((loc) => (
                  <option key={loc} value={loc} />
                ))}
              </datalist>
            </label>

            <div className="bb-inspector-row">
              <label className="bb-inspector-field">
                <span>Slab</span>
                <select
                  className="bb-input bb-input-full"
                  value={d["Slab Status"]}
                  onChange={(e) => setField("Slab Status", e.target.value)}
                >
                  <option value="">—</option>
                  {SLAB_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="bb-inspector-field">
                <span>Grade</span>
                <input
                  type="text"
                  className="bb-input bb-input-full"
                  value={d["Assumed Grade"]}
                  onChange={(e) => setField("Assumed Grade", e.target.value)}
                  placeholder="NM, VF…"
                />
              </label>
            </div>

            <label className="bb-inspector-field">
              <span>Verification notes</span>
              <textarea
                className="bb-input bb-inspector-textarea"
                rows={3}
                value={d["Verification Notes"]}
                onChange={(e) => setField("Verification Notes", e.target.value)}
                placeholder="What’s wrong? What did you verify?"
              />
            </label>

            <div className="bb-inspector-flags">
              {["Needs Verification", "Needs Grading", "Needs Photo", "Upgrade Candidate", "Value Locked"].map(
                (key) => (
                  <label key={key} className="bb-toggle">
                    <input
                      type="checkbox"
                      checked={d[key] === "Yes"}
                      onChange={(e) => setField(key, e.target.checked ? "Yes" : "No")}
                    />
                    <span>{key.replace("Needs ", "").replace(" Candidate", "")}</span>
                  </label>
                )
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="bb-detail-price">{formatCell("Current Price", comic["Current Price"])}</div>

            <div className="bb-badges">
              <span className="bb-badge">{comic["Collection Pillar"]}</span>
              <span className={`bb-badge ${recClass(comic.Recommendation)}`}>{comic.Recommendation}</span>
              <span className={`bb-badge ${priorityClass(comic["Sell Priority"])}`}>
                Sell: {comic["Sell Priority"]}
              </span>
            </div>

            <ScoreBar label="MUS" value={comic["Museum Score"]} />
            <ScoreBar label="INV" value={comic["Investment Score"]} />
            <ScoreBar label="LIQ" value={comic["Liquidity Score"]} />

            <div className="bb-detail-grid">
              <div><span>LOC</span>{comic.Location || "—"}</div>
              <div><span>SLAB</span>{comic["Slab Status"]} {comic["Assumed Grade"] || comic["Grade Rating"]}</div>
              <div><span>PUB</span>{comic.Publisher}</div>
              <div><span>AGE</span>{comic.Age || "—"}</div>
              <div><span>QTY</span>{comic.Quantity}</div>
              <div><span>REL</span>{comic["Release Date"] || "—"}</div>
            </div>

            {comic["Key Comic Reason"] && (
              <div className="bb-detail-note">
                <span className="bb-note-label">KEY ISSUE</span>
                {comic["Key Comic Reason"]}
              </div>
            )}

            {comic["Verification Notes"] && (
              <div className="bb-detail-note bb-detail-note-warn">
                <span className="bb-note-label">VERIFY</span>
                {comic["Verification Notes"]}
              </div>
            )}

            <div className="bb-flags">
              {comic["Needs Grading"] === "Yes" && <span className="bb-flag">NEEDS GRADING</span>}
              {comic["Needs Verification"] === "Yes" && <span className="bb-flag bb-flag-warn">NEEDS VERIFY</span>}
              {comic.Duplicate === "Yes" && <span className="bb-flag bb-flag-warn">DUPLICATE</span>}
              {comic["Upgrade Candidate"] === "Yes" && <span className="bb-flag bb-flag-good">UPGRADE</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
