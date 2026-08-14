"use client";

import { CollectionTerminalStub } from "@/components/CollectionTerminalStub";
import { CLZ_CLOUD_URL } from "@/lib/sourceDrop";

const BINDER_URL = process.env.NEXT_PUBLIC_BINDER_URL ?? "http://localhost:3010";

export function TcgTerminal() {
  return (
    <CollectionTerminalStub
      kicker="Where this tab lives"
      title="TCG TERMINAL"
      sourceLine="Binder Vault · not a second comics grid"
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
    >
      <p>
        There was no TCG Bloomberg tab before this. Cards live in{" "}
        <a href={BINDER_URL} target="_blank" rel="noreferrer">
          Binder Vault
        </a>{" "}
        (layout / pockets) and a TCG slice on Portfolio. A single comics+TCG grid is still
        backlog F.
      </p>
      <p>
        The drop-zone pattern from Comics will land here once a TCG ingest adapter writes the
        same inbox → snapshot → holdings path. Until then this control stays disabled so a
        dropped file cannot be mistaken for a loaded collection.
      </p>
    </CollectionTerminalStub>
  );
}
