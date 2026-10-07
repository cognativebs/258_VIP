import { loadVault } from "@/shell/live/load";
import { VaultView } from "@/shell/views/VaultView";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  return <VaultView model={await loadVault()} />;
}
