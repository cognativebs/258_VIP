"use client";

import { useEffect, useMemo, useState } from "react";
import { CollectionTerminalStub } from "@/components/CollectionTerminalStub";
import { CLZ_CLOUD_URL, CLZ_SPORTS_URL } from "@/lib/sourceDrop";
import { apiGet, type Holding, type InventoryResponse } from "@/lib/api";

function isSportsHolding(h: Holding): boolean {
  if (h.provenance?.source === "ricoh_fi8170") return true;
  if (h.externalIds?.some((e) => e.source === "sports_parsed" || e.source === "cardladder")) {
    return true;
  }
  return /scan intake \(sports\)/i.test(h.publisher);
}

export function SportsTerminal() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<InventoryResponse>("/api/inventory");
        if (cancelled) return;
        setHoldings((data.holdings ?? []).filter(isSportsHolding));
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load sports inventory");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byBucket = useMemo(() => {
    const counts = { personal_collection: 0, investment_vault: 0, dealer_inventory: 0 };
    for (const h of holdings) {
      const b = h.inventoryBucket ?? "dealer_inventory";
      if (b in counts) counts[b as keyof typeof counts] += 1;
    }
    return counts;
  }, [holdings]);

  return (
    <CollectionTerminalStub
      kicker="Where this tab lives"
      title="SPORTS TERMINAL"
      sourceLine="Scan-confirmed holdings + filename/OCR identity · CardSight idle without key"
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
          "Sports CLZ drop is not wired — confirm cards on /scan. Filename/OCR parse IDs year/brand/player.",
        onFile: () => undefined,
      }}
    >
      <p>
        Identification parses year / brand / player / number from the scan file name or OCR
        and stays inferred · unverified until you confirm. Fixture catalog still matches
        Jordan 1986 Topps and Wembanyama Prizm. CardSight is idle without{" "}
        <code>CARDSIGHT_API_KEY</code>. Pricing uses eBay Browse listings · unverified when
        credentials exist — never a fabricated point price.
      </p>
      <p>
        Buckets: Personal {byBucket.personal_collection} · Invest {byBucket.investment_vault} ·
        Dealer {byBucket.dealer_inventory}. Scan confirms default to Dealer Inventory (churn
        capital) until you move them.
      </p>
      {loading ? <p>Loading sports holdings…</p> : null}
      {error ? <p className="bb-detail-error">{error}</p> : null}
      {!loading && holdings.length === 0 ? (
        <p>
          No scan-confirmed sports holdings yet. Import a Ricoh batch on{" "}
          <a href="/scan">/scan</a> with names like{" "}
          <code>1993_upper_deck_derek_jeter_449_front.jpg</code>, then confirm.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="bb-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Bucket</th>
                <th>LIVE</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.id}>
                  <td>
                    <strong>{h.assetName}</strong>
                    <div className="bb-dim">{h.verificationNotes}</div>
                  </td>
                  <td>{h.inventoryBucket ?? "dealer_inventory"}</td>
                  <td>{h.liveRangeLabel ?? "not fetched"}</td>
                  <td className="bb-dim">{h.assumedGrade ?? "NM"} assumed · unverified</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollectionTerminalStub>
  );
}
