import { VERIFICATION_PAGE, loadVerificationQueue } from "@/shell/live/verification";
import { VAULT_REVIEW_HREF } from "@/shell/routes";
import { ReviewQueueClient } from "./ReviewQueueClient";

export const dynamic = "force-dynamic";

export default async function VaultReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const { offset: rawOffset } = await searchParams;
  const parsed = Number(rawOffset);
  const offset = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  const model = await loadVerificationQueue(VERIFICATION_PAGE, offset);
  const shownThrough = offset + model.items.length;
  // Verified books leave the queue, so the next page is computed from the live count.
  const nextHref =
    model.items.length === VERIFICATION_PAGE && shownThrough < model.counts.needsVerification
      ? `${VAULT_REVIEW_HREF}?offset=${shownThrough}`
      : null;
  return <ReviewQueueClient model={model} nextHref={nextHref} />;
}
