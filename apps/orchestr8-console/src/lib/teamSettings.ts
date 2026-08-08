/** Persist Orchestr8 team selection — never API keys. */

import {
  TEAM_PRESETS,
  migrateRoleIds,
  LEGACY_ALIASES,
  type TeamSettings,
  type TeamMode,
} from "./roles";

const STORAGE_KEY = "orchestr8-console-team";

const DEFAULT: TeamSettings = {
  presetId: "build_spec",
  roles: ["architect", "domain_expert", "tester", "critic"],
  mode: "pipeline",
  modelOverrides: {},
  council: "build_spec",
};

export function loadTeamSettings(): TeamSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT, roles: [...DEFAULT.roles], modelOverrides: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT, roles: [...DEFAULT.roles], modelOverrides: {} };
    const parsed = JSON.parse(raw) as Partial<TeamSettings> & { legacyAliases?: Record<string, string> };
    const aliases = parsed.legacyAliases || LEGACY_ALIASES;
    const roles = migrateRoleIds(
      Array.isArray(parsed.roles) && parsed.roles.length ? parsed.roles : DEFAULT.roles,
      aliases
    );
    const modelOverrides: Record<string, string> = {};
    const rawOverrides = parsed.modelOverrides || {};
    for (const [k, v] of Object.entries(rawOverrides)) {
      modelOverrides[migrateRoleIds([k], aliases)[0] ?? k] = v;
    }
    const preset = TEAM_PRESETS.find((p) => p.id === parsed.presetId);
    return {
      presetId: parsed.presetId ?? DEFAULT.presetId,
      roles,
      mode: (parsed.mode as TeamMode) ?? preset?.mode ?? DEFAULT.mode,
      modelOverrides,
      council: parsed.council ?? preset?.council ?? null,
    };
  } catch {
    return { ...DEFAULT, roles: [...DEFAULT.roles], modelOverrides: {} };
  }
}

export function saveTeamSettings(settings: TeamSettings) {
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

export function applyPreset(presetId: string): TeamSettings {
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
