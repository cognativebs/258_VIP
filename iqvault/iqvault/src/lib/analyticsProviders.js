/** Provider registry for comics conversational analytics. */

export const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    ],
    defaultModel: "claude-sonnet-4-6",
    keyLabel: "Anthropic API key",
    keyPlaceholder: "sk-ant-api03-...",
    keyHint: "console.anthropic.com",
    envVar: "ANTHROPIC_API_KEY",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    models: [
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "o4-mini", label: "o4-mini" },
    ],
    defaultModel: "gpt-4.1",
    keyLabel: "OpenAI API key",
    keyPlaceholder: "sk-proj-...",
    keyHint: "platform.openai.com",
    envVar: "OPENAI_API_KEY",
  },
  grok: {
    id: "grok",
    label: "Grok (xAI)",
    models: [
      { id: "grok-3", label: "Grok 3" },
      { id: "grok-3-mini", label: "Grok 3 Mini" },
      { id: "grok-4", label: "Grok 4" },
    ],
    defaultModel: "grok-3",
    keyLabel: "xAI API key",
    keyPlaceholder: "xai-...",
    keyHint: "console.x.ai",
    envVar: "XAI_API_KEY",
  },
  cursor: {
    id: "cursor",
    label: "Cursor (Composer 2.5)",
    models: [
      { id: "composer-2.5", label: "Composer 2.5 (recommended)" },
      { id: "composer-2", label: "Composer 2" },
      { id: "auto", label: "Auto (account default)" },
    ],
    defaultModel: "composer-2.5",
    keyLabel: "Cursor API key",
    keyPlaceholder: "key_... or from Cursor Dashboard → API Keys",
    keyHint: "cursor.com/dashboard → API Keys",
    envVar: "CURSOR_API_KEY",
    slow: true,
    note: "Uses Cursor Cloud Agents (no-repo Q&A). Replies often take 30–90 seconds.",
  },
};

export const PROVIDER_LIST = Object.values(PROVIDERS);
