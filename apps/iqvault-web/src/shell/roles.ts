import {
  roleConfigSchema,
  roleIdSchema,
  type ConceptId,
  type OperateSection,
  type RoleConfig,
  type RoleId,
} from "./schemas";

/**
 * Role config is the only place that states concept order or landing.
 * Founder inherits the collector order by referencing the same array.
 * A new role is a new entry here — views read the context, they do not branch.
 */
const collectorOrder: ConceptId[] = ["VAULT", "INGEST", "ADVISOR", "SIGNALS", "OPERATE"];

const dealerOrder: ConceptId[] = ["OPERATE", "INGEST", "VAULT", "ADVISOR", "SIGNALS"];

const operateSections: OperateSection[] = [
  { id: "sell", label: "Sell" },
  { id: "listings", label: "Listings" },
  { id: "transactions", label: "Transactions" },
  { id: "pricing", label: "Pricing" },
  { id: "catalogs", label: "Catalogs" },
  { id: "integrations", label: "Integrations" },
  { id: "jobs", label: "Jobs" },
];

const ROLE_CONFIG: Record<RoleId, RoleConfig> = {
  collector: {
    id: "collector",
    label: "Collector",
    order: collectorOrder,
    landing: "VAULT",
    secondary: { OPERATE: operateSections },
  },
  dealer: {
    id: "dealer",
    label: "Dealer",
    order: dealerOrder,
    landing: "OPERATE",
    secondary: { OPERATE: operateSections },
  },
  founder: {
    id: "founder",
    label: "Founder",
    order: collectorOrder,
    landing: "VAULT",
    secondary: { OPERATE: operateSections },
  },
};

export const roles = roleIdSchema.options.reduce(
  (acc, id) => {
    acc[id] = roleConfigSchema.parse(ROLE_CONFIG[id]);
    return acc;
  },
  {} as Record<RoleId, RoleConfig>,
);

export const DEFAULT_ROLE_ID: RoleId = "collector";

export function getRole(id: RoleId): RoleConfig {
  return roles[id];
}

export function listRoles(): RoleConfig[] {
  return roleIdSchema.options.map((id) => roles[id]);
}
