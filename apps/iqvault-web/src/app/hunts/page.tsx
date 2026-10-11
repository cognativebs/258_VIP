import { Nav } from "@/components/Nav";
import { HuntsExplorer, type Hunt } from "@/components/hunts/HuntsExplorer";
import { apiGet } from "@/lib/api";

export default async function HuntsPage() {
  let hunts: Hunt[] = [];
  let error: string | null = null;
  let definedHuntsError: string | null = null;
  try {
    const data = await apiGet<{ hunts: Hunt[]; definedHuntsError?: string | null }>("/api/hunts");
    hunts = data.hunts;
    definedHuntsError = data.definedHuntsError ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load hunts";
  }

  return (
    <div className="shell">
      <Nav active="/hunts" />
      {definedHuntsError ? (
        <div className="error">Saved hunts are unavailable (vault_hunt: {definedHuntsError}). Only Need Binder is shown.</div>
      ) : null}
      {error ? <div className="error">{error}</div> : <HuntsExplorer hunts={hunts} />}
    </div>
  );
}
