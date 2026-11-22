"use client";

import { patchComicHolding } from "@/lib/comicsClient";
import type { VerificationModel } from "@/shell/live/verification";
import { VerificationQueueView } from "@/shell/views/VerificationQueueView";

/** Wires the existing comics PATCH path (Comics API, then VIP) into the view. One book per click. */
export function ReviewQueueClient({ model, nextHref }: { model: VerificationModel; nextHref: string | null }) {
  return (
    <VerificationQueueView
      model={model}
      nextHref={nextHref}
      onMark={async (id, needsReview) =>
        Boolean(await patchComicHolding(id, { "Needs Verification": needsReview ? "Yes" : "No" }))
      }
    />
  );
}
