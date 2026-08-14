"use client";

import { CollectionTerminalStub } from "@/components/CollectionTerminalStub";
import { CLZ_CLOUD_URL, CLZ_SPORTS_URL } from "@/lib/sourceDrop";

export function SportsTerminal() {
  return (
    <CollectionTerminalStub
      kicker="Where this tab lives"
      title="SPORTS TERMINAL"
      sourceLine="Catalog schema only · no holdings ingest"
      links={[
        {
          href: CLZ_SPORTS_URL,
          label: "CLZ Sports Collector",
          title: "Open CLZ Sports Collector in a new window",
        },
        {
          href: CLZ_CLOUD_URL,
          label: "CLZ Cloud",
          title: "Open CLZ Cloud in a new window",
        },
      ]}
      drop={{
        acceptHint: "Drop sports export here (not wired yet)",
        enabled: false,
        disabledReason:
          "Sports drop-to-inbox is not wired — vault_sports is catalog only, no holdings loader",
        onFile: () => undefined,
      }}
    >
      <p>
        There was no sportscard Bloomberg tab. Sports exists as a SQL catalog (
        <code>vault_sports</code> in <code>03_sports_comics.sql</code>) — product / subset /
        parallel / card — with no collector ingest, no CLZ sports XML job, and no grid.
      </p>
      <p>
        Same source-bar + drop-zone shell as Comics. The drop stays disabled until a sports
        adapter archives an export into an inbox and regenerates holdings with provenance.
      </p>
    </CollectionTerminalStub>
  );
}
