import { notFound, redirect } from "next/navigation";
import { CollectionHub } from "@/components/collections/CollectionHub";
import { COLLECTION_TABS, isCollectionTabId } from "@/lib/collectionTabs";

export function generateStaticParams() {
  return COLLECTION_TABS.map((t) => ({ vertical: t.id }));
}

export default async function CollectionVerticalPage({
  params,
}: {
  params: Promise<{ vertical: string }>;
}) {
  const { vertical } = await params;
  if (vertical === "comics") redirect("/collections/comic");
  if (!isCollectionTabId(vertical)) notFound();
  return <CollectionHub vertical={vertical} />;
}
