import { Nav } from "@/components/Nav";
import { HuntsExplorer, type Hunt } from "@/components/hunts/HuntsExplorer";
import { apiGet } from "@/lib/api";

export default async function HuntsPage() {
  let hunts: Hunt[] = [];
  let error: string | null = null;
  try {
    const data = await apiGet<{ hunts: Hunt[] }>("/api/hunts");
    hunts = data.hunts;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load hunts";
  }

  return (
    <div className="shell">
      <Nav active="/hunts" />
      {error ? <div className="error">{error}</div> : <HuntsExplorer hunts={hunts} />}
    </div>
  );
}
