import { loadSignals } from "@/shell/live/load";
import { SignalsView } from "@/shell/views/SignalsView";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  return <SignalsView model={await loadSignals()} />;
}
