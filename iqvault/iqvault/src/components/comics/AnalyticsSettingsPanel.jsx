import { useState } from "react";
import { PROVIDERS, PROVIDER_LIST } from "../../lib/analyticsProviders.js";
import { saveAnalyticsSettings, hasEnvKey, maskKey } from "../../lib/analyticsSettings.js";

export default function AnalyticsSettingsPanel({ settings, onChange, onClose }) {
  const [draft, setDraft] = useState(() => ({
    ...settings,
    keys: { ...settings.keys },
  }));

  const provider = PROVIDERS[draft.provider] ?? PROVIDERS.anthropic;

  const setProvider = (id) => {
    const p = PROVIDERS[id];
    setDraft((d) => ({
      ...d,
      provider: id,
      model: p.defaultModel,
    }));
  };

  const save = () => {
    saveAnalyticsSettings(draft);
    onChange(draft);
    onClose?.();
  };

  return (
    <div className="bb-settings-overlay" onClick={onClose}>
      <div className="bb-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bb-settings-head">
          <h3>Analytics API settings</h3>
          <button type="button" className="bb-settings-close" onClick={onClose}>×</button>
        </div>

        <p className="bb-settings-intro">
          Keys are stored in your browser only (localStorage). Optional: add the same keys to{" "}
          <code>iqvault/.env.local</code> for server-side fallback — restart dev server after.
        </p>

        <label className="bb-settings-field">
          <span>Active provider</span>
          <select
            value={draft.provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {PROVIDER_LIST.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>

        <label className="bb-settings-field">
          <span>Model</span>
          <select
            value={draft.model}
            onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
          >
            {provider.models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>

        {provider.slow && (
          <p className="bb-settings-warn">{provider.note}</p>
        )}

        <div className="bb-settings-keys">
          <p className="bb-settings-keys-title">API keys (optional — leave blank to use .env.local)</p>
          {PROVIDER_LIST.map((p) => {
            const envSet = hasEnvKey(p.id);
            const stored = draft.keys[p.id];
            return (
              <label key={p.id} className="bb-settings-key-row">
                <span>
                  {p.label}
                  {envSet && <em className="bb-env-badge">env</em>}
                  {stored && !envSet && <em className="bb-env-badge local">saved</em>}
                </span>
                <input
                  type="password"
                  placeholder={p.keyPlaceholder}
                  value={stored}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      keys: { ...d.keys, [p.id]: e.target.value },
                    }))
                  }
                  autoComplete="off"
                />
                <small>{p.keyHint}{stored ? ` · ${maskKey(stored)}` : ""}</small>
              </label>
            );
          })}
        </div>

        <pre className="bb-settings-env-example">{`# iqvault/.env.local (optional)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
XAI_API_KEY=xai-...
CURSOR_API_KEY=...`}</pre>

        <div className="bb-settings-actions">
          <button type="button" className="bb-btn bb-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="bb-btn bb-btn-analytics" onClick={save}>Save settings</button>
        </div>
      </div>
    </div>
  );
}
