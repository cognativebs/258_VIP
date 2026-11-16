"use client";

import { useEffect, useReducer, useState, type KeyboardEvent } from "react";
import { SEARCH_GROUPS, type SearchResponse } from "../search/contract";
import { SEARCH_NOT_CONNECTED, stubSearchResolver } from "../search/stub";

export type PaletteState = { open: boolean; activeIndex: number };
export type PaletteEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "next"; count: number }
  | { type: "prev"; count: number }
  | { type: "enter" };

export function paletteReducer(state: PaletteState, event: PaletteEvent): PaletteState {
  if (event.type === "open") return { open: true, activeIndex: state.activeIndex };
  if (event.type === "close") return { open: false, activeIndex: 0 };
  if (event.type === "toggle") return state.open ? { open: false, activeIndex: 0 } : { open: true, activeIndex: 0 };
  if (!state.open || event.type === "enter") return state;
  const count = Math.max(event.count, 1);
  const delta = event.type === "next" ? 1 : -1;
  return { ...state, activeIndex: (state.activeIndex + delta + count) % count };
}

const EMPTY_RESPONSE: SearchResponse = {
  connected: false,
  query: "",
  results: [],
  notice: SEARCH_NOT_CONNECTED,
};

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse>(EMPTY_RESPONSE);
  const [cursor, dispatch] = useReducer(paletteReducer, { open: true, activeIndex: 0 });

  useEffect(() => {
    let cancelled = false;
    void stubSearchResolver(query).then((next) => {
      if (!cancelled) setResponse(next);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      dispatch({ type: "next", count: SEARCH_GROUPS.length });
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      dispatch({ type: "prev", count: SEARCH_GROUPS.length });
    }
    if (event.key === "Enter") {
      event.preventDefault();
      dispatch({ type: "enter" });
    }
  }

  return (
    <div className="vip-palette-scrim" role="presentation" onMouseDown={onClose}>
      <div
        className="vip-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          className="vip-palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Query"
          aria-label="Query"
          autoFocus
        />
        <p className="vip-palette-notice">{response.connected ? null : response.notice}</p>
        <div className="vip-palette-groups" role="listbox" aria-label="Search groups">
          {SEARCH_GROUPS.map((group, index) => {
            const hits = response.connected ? response.results.filter((result) => result.type === group.type) : [];
            return (
              <section
                key={group.type}
                className={index === cursor.activeIndex ? "vip-palette-group is-active" : "vip-palette-group"}
                data-group={group.type}
                role="option"
                aria-selected={index === cursor.activeIndex}
              >
                <header>
                  <h3>{group.label}</h3>
                  <span className="vip-num">{hits.length}</span>
                </header>
                {hits.map((hit) => (
                  <p key={hit.id}>{hit.title}</p>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
