import { loadAdvisor } from "@/shell/live/load";
import { AdvisorView } from "@/shell/views/AdvisorView";

export const dynamic = "force-dynamic";

export default async function AdvisorPage() {
  return <AdvisorView model={await loadAdvisor()} />;
}
