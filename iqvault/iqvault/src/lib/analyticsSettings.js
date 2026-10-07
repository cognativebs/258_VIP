/** Persist analytics provider, model, and API keys (localStorage only). */

import { PROVIDERS, PROVIDER_LIST } from "./analyticsProviders.js";

const STORAGE_KEY = "iqvault-comics-analytics-settings";

const DEFAULT_SETTINGS = {
  provider: "anthropic",
  model: PROVIDERS.anthropic.defaultModel,
  keys: {
    anthropic: "",
    openai: "",
    grok: "",
    cursor: "",
  },
};

export function loadAnalyticsSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_SETTINGS.keys } };
    const parsed = JSON.parse(raw);
    const provider = PROVIDERS[parsed.provider] ? parsed.provider : DEFAULT_SETTINGS.provider;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      provider,
      model: parsed.model || PROVIDERS[provider].defaultModel,
      keys: { ...DEFAULT_SETTINGS.keys, ...(parsed.keys ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_SETTINGS.keys } };
  }
}

export function saveAnalyticsSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getProviderKey(settings) {
  const key = settings.keys?.[settings.provider]?.trim();
  return key || "";
}

export function hasEnvKey(providerId) {
  const env = typeof __IQVAULT_LLM_ENV__ !== "undefined" ? __IQVAULT_LLM_ENV__ : {};
  return Boolean(env[providerId]);
}

export function isProviderReady(settings) {
  return Boolean(getProviderKey(settings) || hasEnvKey(settings.provider));
}

export function isAnyProviderReady(settings) {
  return PROVIDER_LIST.some(
    (p) => getProviderKey({ ...settings, provider: p.id }) || hasEnvKey(p.id)
  );
}

export function maskKey(key) {
  if (!key || key.length < 8) return key ? "••••" : "";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export { PROVIDER_LIST };
