import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  buildAnalyticsContext,
  contextToJson,
  SUGGESTED_PROMPTS,
} from "../../lib/comicAnalyticsContext.js";
import { sendAnalyticsMessage } from "../../lib/comicsAnalyticsApi.js";
import {
  loadAnalyticsSettings,
  isProviderReady,
  getProviderKey,
} from "../../lib/analyticsSettings.js";
import { PROVIDERS } from "../../lib/analyticsProviders.js";
import AnalyticsSettingsPanel from "./AnalyticsSettingsPanel.jsx";

export default function ComicsAnalyticsChat({
  meta,
  filtered,
  dashboardStats,
  filters,
  workspace,
  selectedComic,
  filteredValue,
}) {
  const [settings, setSettings] = useState(loadAnalyticsSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cursorAgentId, setCursorAgentId] = useState(null);
  const scrollRef = useRef(null);

  const provider = PROVIDERS[settings.provider] ?? PROVIDERS.anthropic;
  const configured = isProviderReady(settings);

  const contextJson = useMemo(
    () =>
      contextToJson(
        buildAnalyticsContext({
          meta,
          filtered,
          dashboardStats,
          filters,
          workspace,
          selectedComic,
          filteredValue,
        })
      ),
    [meta, filtered, dashboardStats, filters, workspace, selectedComic, filteredValue]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(
    async (text) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      setError(null);
      const userMsg = { role: "user", content: trimmed };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setInput("");
      setLoading(true);

      try {
        const { text: reply, cursorAgentId: newAgentId } = await sendAnalyticsMessage({
          provider: settings.provider,
          model: settings.model,
          messages: nextMessages,
          contextJson,
          apiKey: getProviderKey(settings),
          cursorAgentId: settings.provider === "cursor" ? cursorAgentId : undefined,
        });
        if (newAgentId) setCursorAgentId(newAgentId);
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      } catch (e) {
        setError(e.message || "Request failed");
      } finally {
        setLoading(false);
      }
    },
    [messages, loading, contextJson, settings, cursorAgentId]
  );

  const clearChat = () => {
    setMessages([]);
    setError(null);
    setCursorAgentId(null);
  };

  const loadingLabel =
    settings.provider === "cursor"
      ? `Composer analyzing ${filtered.length.toLocaleString()} books (30–90s)…`
      : `Analyzing ${filtered.length.toLocaleString()} books…`;

  return (
    <div className="bb-analytics">
      <div className="bb-analytics-head">
        <span>Conversational analytics</span>
        <div className="bb-analytics-head-right">
          <span className="bb-analytics-provider">
            {provider.label} · {provider.models.find((m) => m.id === settings.model)?.label ?? settings.model}
          </span>
          <button type="button" className="bb-link-btn" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </div>

      {!configured && (
        <div className="bb-analytics-setup">
          <p>Add an API key to enable analytics:</p>
          <button type="button" className="bb-btn bb-btn-primary" onClick={() => setShowSettings(true)}>
            Open API settings
          </button>
          <p className="bb-analytics-setup-note">
            Supports Anthropic, OpenAI, Grok (xAI), and Cursor Composer 2.5.
          </p>
        </div>
      )}

      <div className="bb-analytics-msgs" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="bb-analytics-welcome">
            <p>
              Ask about your <strong>current filter</strong> — sells, museum picks, pillar review,
              grading, liquidity timing.
            </p>
            <div className="bb-prompt-grid">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="bb-prompt-chip"
                  disabled={!configured || loading}
                  onClick={() => send(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`bb-msg bb-msg-${m.role}`}>
            <span className="bb-msg-role">{m.role === "user" ? "You" : "IQVault"}</span>
            <div className="bb-msg-body">{m.content}</div>
          </div>
        ))}

        {loading && (
          <div className="bb-msg bb-msg-assistant">
            <span className="bb-msg-role">IQVault</span>
            <div className="bb-msg-body bb-msg-loading">
              <span className="bb-blink">▮</span> {loadingLabel}
            </div>
          </div>
        )}
      </div>

      {error && <div className="bb-analytics-error">{error}</div>}

      <form
        className="bb-analytics-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          className="bb-analytics-input"
          rows={2}
          placeholder={configured ? "Ask about this filter…" : "Open Settings to add an API key"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!configured || loading}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <div className="bb-analytics-actions">
          <button type="button" className="bb-btn bb-btn-ghost" onClick={clearChat} disabled={!messages.length}>
            Clear
          </button>
          <button
            type="submit"
            className="bb-btn bb-btn-analytics"
            disabled={!configured || loading || !input.trim()}
          >
            Analyze
          </button>
        </div>
      </form>

      {showSettings && (
        <AnalyticsSettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
