import { TEAM_PRESETS, migrateRoleIds, LEGACY_ALIASES } from "./roles";

const STORAGE_KEY = "iqvault-orchestr8-team";

export type TeamSettings = {
  presetId: string;
  roles: string[];
  mode: string;
  modelOverrides: Record<string, string>;
  council: string | null;
};

const DEFAULT: TeamSettings = {
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

export function loadTeamSettings(): TeamSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT, roles: [...DEFAULT.roles], modelOverrides: {} };
    const parsed = JSON.parse(raw) as Partial<TeamSettings>;
    const roles = migrateRoleIds(
      Array.isArray(parsed.roles) && parsed.roles.length ? parsed.roles : DEFAULT.roles,
      LEGACY_ALIASES,
    );
    const modelOverrides: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.modelOverrides || {})) {
      modelOverrides[migrateRoleIds([k], LEGACY_ALIASES)[0] ?? k] = String(v);
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

export function saveTeamSettings(settings: TeamSettings) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      presetId: settings.presetId,
      roles: settings.roles,
      mode: settings.mode,
      modelOverrides: settings.modelOverrides || {},
      council: settings.council ?? null,
    }),
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
