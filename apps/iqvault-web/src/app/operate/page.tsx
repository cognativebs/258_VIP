import { loadOperate } from "@/shell/live/load";
import { OperateView } from "@/shell/views/OperateView";

export const dynamic = "force-dynamic";

export default async function OperatePage() {
  return <OperateView model={await loadOperate()} />;
}
