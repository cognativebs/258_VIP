"use client";

import { CollectionSourceBar } from "@/components/CollectionSourceBar";
import { CLZ_CLOUD_URL } from "@/lib/sourceDrop";

const BINDER_URL = process.env.NEXT_PUBLIC_BINDER_URL ?? "http://localhost:3010";

/** Source bar on the live TCG page — drop stays off until a TCG ingest adapter exists. */
export function TcgSourceBar() {
  return (
    <CollectionSourceBar
      links={[
        {
          href: BINDER_URL,
          label: "Binder Vault",
          title: "Open Binder Vault in a new window",
        },
        {
          href: CLZ_CLOUD_URL,
          label: "CLZ Cloud",
          title: "Open CLZ Cloud in a new window",
        },
      ]}
      drop={{
        acceptHint: "Drop TCG export here (not wired yet)",
        enabled: false,
        disabledReason:
          "TCG drop-to-inbox is not wired — layout and owned flags live in Binder Vault",
        onFile: () => undefined,
      }}
    />
  );
}
