import { loadOperate } from "@/shell/live/load";
import { OperateView } from "@/shell/views/OperateView";

export const dynamic = "force-dynamic";

export default async function OperateSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  return <OperateView model={await loadOperate()} sectionId={section} />;
}
