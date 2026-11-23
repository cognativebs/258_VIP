import { loadHome } from "@/shell/live/load";
import { HomeView } from "@/shell/views/HomeView";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await loadHome();
  return <HomeView vault={data.vault} signals={data.signals} ingest={data.ingest} />;
}
