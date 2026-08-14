/** Persist Orchestr8 team selection (roles + mode + model overrides) - never API keys. */

import {
  TEAM_PRESETS,
  migrateRoleIds,
  LEGACY_ALIASES,
  type TeamPreset,
} from "./orchestr8Roles";

const STORAGE_KEY = "iqvault-web-orchestr8-team";

export type TeamSettings = {
  presetId: string;
  roles: string[];
  mode: "single" | "pipeline" | "parallel";
  modelOverrides: Record<string, string>;
  council: string | null;
};

const DEFAULT: TeamSettings = {
  presetId: "council_analysis",
  roles: [
    "investment_analyst",
    "pricing_agent",
    "liquidity_analyst",
    "portfolio_manager",
    "analyst",
    "prediction_engine",
  ],
  mode: "parallel",
  modelOverrides: {},
  council: "analysis",
};

function isMode(v: unknown): v is TeamSettings["mode"] {
  return v === "single" || v === "pipeline" || v === "parallel";
}

export function loadTeamSettings(): TeamSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT, roles: [...DEFAULT.roles], modelOverrides: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT, roles: [...DEFAULT.roles], modelOverrides: {} };
    const parsed = JSON.parse(raw) as {
      presetId?: string;
      roles?: string[];
      mode?: string;
      modelOverrides?: Record<string, string>;
      council?: string | null;
      legacyAliases?: Record<string, string>;
    };
    const aliases = parsed.legacyAliases || LEGACY_ALIASES;
    const roles = migrateRoleIds(
      Array.isArray(parsed.roles) && parsed.roles.length ? parsed.roles : DEFAULT.roles,
      aliases,
    );
    const modelOverrides: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.modelOverrides || {})) {
      const migrated = migrateRoleIds([k], aliases)[0] ?? k;
      modelOverrides[migrated] = v;
    }
    const preset = TEAM_PRESETS.find((p) => p.id === parsed.presetId);
    return {
      presetId: parsed.presetId ?? DEFAULT.presetId,
      roles,
      mode: isMode(parsed.mode) ? parsed.mode : (preset?.mode ?? DEFAULT.mode),
      modelOverrides,
      council: parsed.council ?? preset?.council ?? null,
    };
  } catch {
    return { ...DEFAULT, roles: [...DEFAULT.roles], modelOverrides: {} };
  }
}

export function saveTeamSettings(settings: TeamSettings): void {
  if (typeof window === "undefined") return;
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
  const preset: TeamPreset | undefined = TEAM_PRESETS.find((p) => p.id === presetId);
  if (!preset) return loadTeamSettings();
  return {
    presetId,
    roles: [...preset.roles],
    mode: preset.mode,
    modelOverrides: {},
    council: preset.council ?? null,
  };
}
