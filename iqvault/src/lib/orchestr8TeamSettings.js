/** Persist Orchestr8 team selection (roles + mode + model overrides) — never API keys. */

import { TEAM_PRESETS, migrateRoleIds, LEGACY_ALIASES } from "./orchestr8Roles.js";

const STORAGE_KEY = "iqvault-orchestr8-team";

const DEFAULT = {
  presetId: "comics_vip",
  roles: [
    "researcher",
    "investment_analyst",
    "pricing_agent",
    "liquidity_analyst",
    "critic",
    "synthesizer",
  ],
  mode: "pipeline",
  modelOverrides: {},
  council: null,
};

export function loadTeamSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT, roles: [...DEFAULT.roles], modelOverrides: {} };
    const parsed = JSON.parse(raw);
    const aliases = parsed.legacyAliases || LEGACY_ALIASES;
    const roles = migrateRoleIds(
      Array.isArray(parsed.roles) && parsed.roles.length ? parsed.roles : DEFAULT.roles,
      aliases
    );
    const modelOverrides = {};
    const rawOverrides = parsed.modelOverrides || {};
    for (const [k, v] of Object.entries(rawOverrides)) {
      modelOverrides[migrateRoleIds([k], aliases)[0] ?? k] = v;
    }
    const preset = TEAM_PRESETS.find((p) => p.id === parsed.presetId);
    return {
      presetId: parsed.presetId ?? DEFAULT.presetId,
      roles,
      mode: parsed.mode ?? preset?.mode ?? DEFAULT.mode,
      modelOverrides,
      council: parsed.council ?? preset?.council ?? null,
    };
  } catch {
    return { ...DEFAULT, roles: [...DEFAULT.roles], modelOverrides: {} };
  }
}

export function saveTeamSettings(settings) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      presetId: settings.presetId,
      roles: settings.roles,
      mode: settings.mode,
      modelOverrides: settings.modelOverrides || {},
      council: settings.council ?? null,
    })
  );
}

export function applyPreset(presetId) {
  const preset = TEAM_PRESETS.find((p) => p.id === presetId);
  if (!preset) return loadTeamSettings();
  return {
    presetId,
    roles: [...preset.roles],
    mode: preset.mode,
    modelOverrides: {},
    council: preset.council ?? null,
  };
}
