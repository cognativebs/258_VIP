import { conceptIdSchema, type ConceptId } from "./schemas";

/** Stable paths. Key order is not a role order. */
export const CONCEPT_HREFS: Record<ConceptId, string> = {
  ADVISOR: "/advisor",
  VAULT: "/vault",
  OPERATE: "/operate",
  INGEST: "/ingest",
  SIGNALS: "/signals",
};

export const HOME_HREF = "/home";

export function conceptHref(id: ConceptId): string {
  return CONCEPT_HREFS[id];
}

export function operateHref(sectionId: string): string {
  return `${CONCEPT_HREFS.OPERATE}/${sectionId}`;
}

export function conceptFromPath(pathname: string): ConceptId | "HOME" | null {
  if (pathname === HOME_HREF || pathname.startsWith(`${HOME_HREF}/`)) return "HOME";
  const matches = conceptIdSchema.options.filter((id) => {
    const href = CONCEPT_HREFS[id];
    return pathname === href || pathname.startsWith(`${href}/`);
  });
  matches.sort((a, b) => CONCEPT_HREFS[b].length - CONCEPT_HREFS[a].length);
  return matches[0] ?? null;
}
