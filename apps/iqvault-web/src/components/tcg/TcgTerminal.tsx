"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { CollectionSourceBar } from "@/components/CollectionSourceBar";
import { apiGet, BINDER_URL, type Holding, type InventoryResponse } from "@/lib/api";
import { splitTcgHoldings } from "@/lib/collections";
import { CLZ_CLOUD_URL } from "@/lib/sourceDrop";
import { tcgCardDisplay, tcgCardName } from "@/lib/tcgCard";

function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function statusLabel(h: Holding): "Owned" | "Need" | "Seed" {
  if (h.pillar === "TCG Owned (Binder)") return "Owned";
  if (h.pillar === "TCG Need (Binder)") return "Need";
  return "Seed";
}

export function TcgSourceBar({ children }: { children?: ReactNode }) {
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
    >
      {children}
    </CollectionSourceBar>
  );
}

export function TcgTerminal() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [tcgSource, setTcgSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "owned" | "need">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<InventoryResponse>("/api/inventory");
        if (cancelled) return;
        setHoldings(data.holdings ?? []);
        setTcgSource(data.tcgSource ?? "vip");
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load VIP inventory");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const split = useMemo(() => splitTcgHoldings(holdings), [holdings]);
  const usingSeeds = split.owned.length === 0 && split.seeds.length > 0;
  const catalog = useMemo(() => {
    if (scope === "owned") return usingSeeds ? split.seeds : split.owned;
    if (scope === "need") return split.need;
    return usingSeeds ? [...split.seeds, ...split.need] : [...split.owned, ...split.need];
  }, [scope, split, usingSeeds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((h) => {
      const d = tcgCardDisplay(h);
      return [d.cardName, d.setName, d.number, h.rarity, h.assetName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [catalog, query]);

  const ownedValue = split.ownedValue;
  const sourceLine = tcgSource ? `VIP inventory · ${tcgSource}` : "VIP inventory";

  if (loading) {
    return (
      <div className="bb-terminal bb-terminal-embedded">
        <TcgSourceBar>
          <div className="bb-loading">Loading Pokémon TCG terminal…</div>
        </TcgSourceBar>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bb-terminal bb-error bb-terminal-embedded">
        <TcgSourceBar>
          <p>{error}</p>
          <p className="bb-detail-hint-lg">Start VIP API:</p>
          <code>npm run api</code>
        </TcgSourceBar>
      </div>
    );
  }

  return (
    <div className="bb-terminal bb-terminal-embedded">
      <TcgSourceBar>
      <div className="bb-topbar">
        <div className="bb-topbar-brand">
          <span className="bb-orange">IQVAULT</span>
          <span className="bb-dim">POKÉMON TCG TERMINAL</span>
          <span className="bb-dim" style={{ marginLeft: 8 }}>
            · {sourceLine}
          </span>
        </div>
        <div className="bb-topbar-stats">
          <span>
            <em>Cards</em> {catalog.length.toLocaleString()}
          </span>
          <span>
            <em>Owned</em> {(usingSeeds ? split.seeds : split.owned).length.toLocaleString()}
          </span>
          <span>
            <em>Need</em> {split.need.length.toLocaleString()}
          </span>
          <span>
            <em>Value</em> {usd(ownedValue)}
          </span>
        </div>
      </div>

      <div className="bb-command">
        <span className="bb-prompt">Search</span>
        <input
          className="bb-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Card name, set, number…"
          spellCheck={false}
        />
        {(["all", "owned", "need"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={`bb-ws-chip ${scope === id ? "active" : ""}`}
            onClick={() => setScope(id)}
          >
            {id.toUpperCase()}
          </button>
        ))}
      </div>

      {usingSeeds ? (
        <p className="bb-stub-kicker">
          No owned Binder pockets yet — showing Pokémon seed rows, not your binder. Mark
          pockets owned in Binder and Push to VIP.
        </p>
      ) : null}

      <div className="bb-layout bb-layout-no-filters">
      <section className="bb-table-panel">
        <div className="bb-table-scroll">
          <table className="bb-table">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>CARD</th>
                <th style={{ minWidth: 140 }}>SET</th>
                <th style={{ minWidth: 48 }}>#</th>
                <th style={{ minWidth: 90 }}>RARITY</th>
                <th style={{ minWidth: 80 }} className="num">
                  VALUE
                </th>
                <th style={{ minWidth: 72 }}>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="bb-empty-row">
                    No cards match. Place cards in Binder, then Push to VIP.
                  </td>
                </tr>
              ) : (
                filtered.map((h) => {
                  const d = tcgCardDisplay(h);
                  const st = statusLabel(h);
                  return (
                    <tr key={h.id}>
                      <td>
                        <div className="bb-tcg-name">
                          {h.coverImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="bb-tcg-thumb"
                              src={h.coverImageUrl}
                              alt=""
                            />
                          ) : (
                            <span className="bb-tcg-thumb bb-tcg-thumb-empty" />
                          )}
                          <div>
                            <strong>{d.cardName}</strong>
                            <div className="bb-dim" style={{ fontSize: 11 }}>
                              {tcgCardName(h) !== h.assetName ? h.publisher : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>{d.setName}</td>
                      <td>{d.number || "—"}</td>
                      <td className="bb-dim">{h.rarity || "—"}</td>
                      <td className="num">
                        {h.currentPrice != null ? usd(h.currentPrice) : "—"}
                      </td>
                      <td>
                        <span
                          className={
                            st === "Owned"
                              ? "bb-tcg-status owned"
                              : st === "Need"
                                ? "bb-tcg-status need"
                                : "bb-tcg-status seed"
                          }
                        >
                          {st}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
      </div>
      </TcgSourceBar>
    </div>
  );
}
