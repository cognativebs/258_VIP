"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  POCKET_PRESETS,
  SPINE_COLORS,
  ERA_TEMPLATES,
} from "@/lib/templates";
import { RARITY_FILTERS, type SetOption } from "@/lib/filters";
import {
  filterSets,
  mergeSets,
  QUICK_SET_CHIPS,
  SEED_SETS,
  setLabel,
} from "@/lib/set-catalog";
import type { ApiBinder, ApiSlot, CardResult, WishlistItem } from "@/lib/contracts";
import {
  collectValueLines,
  computeValueTotals,
  formatPriceAsOf,
  formatUsd,
  maxPriceUpdatedAt,
  pocketCoord,
  type ValueLine,
} from "@/lib/value";

const ALL_RARITY_KEYS = RARITY_FILTERS.map((r) => r.key);
const HIGHLIGHT_MISSING_KEY = "binder-vault.highlightMissing";

function readHighlightMissing(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HIGHLIGHT_MISSING_KEY) === "1";
  } catch {
    return false;
  }
}

type WishlistExportForm = {
  scope: "binder" | "all";
  starredOnly: boolean;
  includeImages: boolean;
  includePrices: boolean;
  contactName: string;
  note: string;
};

type WishlistPrintPayload = {
  items: WishlistItem[];
  includeImages: boolean;
  includePrices: boolean;
  contactName: string;
  note: string;
  title: string;
  generatedAt: number;
};

const DEFAULT_WISHLIST_FORM: WishlistExportForm = {
  scope: "binder",
  starredOnly: true,
  includeImages: true,
  includePrices: true,
  contactName: "",
  note: "",
};

function wishlistItemImageSrc(item: WishlistItem): string | null {
  if (item.imageLocal) return `/api/media/${item.imageLocal}`;
  return item.imageUrl;
}

const DND_MIME = "application/x-binder-vault";

function setDragPayload(
  e: React.DragEvent,
  payload: { type: "card"; card: CardResult } | { type: "slot"; slotId: string },
  effect: "copy" | "move" = "copy",
) {
  const raw = JSON.stringify(payload);
  e.dataTransfer.effectAllowed = effect === "move" ? "move" : "copyMove";
  // Custom MIME + text/plain — some browsers reject drops without a plain text type.
  e.dataTransfer.setData(DND_MIME, raw);
  e.dataTransfer.setData("application/json", raw);
  e.dataTransfer.setData("text/plain", raw);
}

function readDragPayload(e: React.DragEvent): string {
  return (
    e.dataTransfer.getData(DND_MIME) ||
    e.dataTransfer.getData("application/json") ||
    e.dataTransfer.getData("text/plain") ||
    ""
  );
}

function allowPocketDrop(e: React.DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  // Page-tab drags are for the tab strip only — don't treat pockets as targets.
  if (Array.from(e.dataTransfer.types).includes("text/page-index")) {
    e.dataTransfer.dropEffect = "none";
    return;
  }
  // Slot rearranges set effectAllowed="move". Chromium rejects the drop if
  // dropEffect is "copy" while only "move" is allowed — so match the source.
  const allowed = e.dataTransfer.effectAllowed;
  e.dataTransfer.dropEffect =
    allowed === "move" || allowed === "linkMove" || allowed === "all" ? "move" : "copy";
}

type CardSource = "all" | "pokemontcg" | "tcgdex";

type NewBinderForm = {
  name: string;
  spineColor: string;
  mode: "pocket" | "era";
  presetKey: string;
  eraKey: string;
  rows: number;
  cols: number;
};

const DEFAULT_FORM: NewBinderForm = {
  name: "",
  spineColor: SPINE_COLORS[0],
  mode: "pocket",
  presetKey: "9",
  eraKey: ERA_TEMPLATES[0].key,
  rows: 3,
  cols: 3,
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

function slotImageSrc(slot: ApiSlot): string | null {
  if (!slot.card) return null;
  if (slot.card.imageLocal) return `/api/media/${slot.card.imageLocal}`;
  return slot.card.imageUrl;
}

export function BinderVault() {
  const [binders, setBinders] = useState<ApiBinder[]>([]);
  const [activeBinderId, setActiveBinderId] = useState<string | null>(null);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [booted, setBooted] = useState(false);

  const [showNewBinder, setShowNewBinder] = useState(false);
  const [form, setForm] = useState<NewBinderForm>(DEFAULT_FORM);

  const [lightbox, setLightbox] = useState<{ src: string; meta: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [source, setSource] = useState<CardSource>("all");
  const [setFilter, setSetFilter] = useState("");
  /** All on by default — toggle off types you don't want. */
  const [rarityFilters, setRarityFilters] = useState<string[]>(() => [...ALL_RARITY_KEYS]);
  // Seed instantly so the picker is never "All sets" only while upstream 500s.
  const [sets, setSets] = useState<SetOption[]>(SEED_SETS);
  const [results, setResults] = useState<CardResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string>("");
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [updatingHistory, setUpdatingHistory] = useState(false);
  const [syncingOwned, setSyncingOwned] = useState(false);
  const [pushingVip, setPushingVip] = useState(false);
  const [showWishlistExport, setShowWishlistExport] = useState(false);
  const [wishlistForm, setWishlistForm] = useState<WishlistExportForm>(DEFAULT_WISHLIST_FORM);
  const [wishlistPrinting, setWishlistPrinting] = useState(false);
  const [wishlistPrint, setWishlistPrint] = useState<WishlistPrintPayload | null>(null);
  const [showTransferPage, setShowTransferPage] = useState(false);
  const [transferMode, setTransferMode] = useState<"move" | "copy">("move");
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [valueScope, setValueScope] = useState<"page" | "binder">("page");
  const [valueSelected, setValueSelected] = useState<Set<string>>(() => new Set());
  /** Dim owned pockets so still-needed cards stand out. */
  const [highlightMissing, setHighlightMissing] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /** Narrow windows hide the Ledger rail; this toggle brings it back. */
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [lanUrl, setLanUrl] = useState("");
  /** Touch rearrange: tap a filled pocket, then tap a destination. */
  const [moveFromSlotId, setMoveFromSlotId] = useState<string | null>(null);

  useEffect(() => {
    setHighlightMissing(readHighlightMissing());
    if (typeof window !== "undefined") {
      setLanUrl(window.location.origin);
    }
  }, []);

  const toggleHighlightMissing = useCallback(() => {
    setHighlightMissing((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(HIGHLIGHT_MISSING_KEY, next ? "1" : "0");
      } catch {
        /* ignore quota / private mode */
      }
      return next;
    });
  }, []);

  const uploadTargetRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const allRaritiesOn = rarityFilters.length === ALL_RARITY_KEYS.length;
  const noRaritiesOn = rarityFilters.length === 0;
  /** User narrowed rarity chips (subset or none) — all-on means no rarity restriction. */
  const rarityNarrowed = !allRaritiesOn;
  const hasSearchFilters = !!(setFilter || rarityNarrowed);

  const activeBinder = useMemo(
    () => binders.find((b) => b.id === activeBinderId) ?? null,
    [binders, activeBinderId],
  );
  const activePage = activeBinder?.pages[activePageIndex] ?? null;
  const pagePricesAsOf = useMemo(
    () =>
      activeBinder
        ? formatPriceAsOf(maxPriceUpdatedAt(activeBinder, "page", activePageIndex))
        : "",
    [activeBinder, activePageIndex],
  );

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const copyLanUrl = useCallback(async () => {
    if (!lanUrl) return;
    try {
      await navigator.clipboard.writeText(lanUrl);
      flash("Binder URL copied — open on your phone (same Wi‑Fi)");
    } catch {
      flash(lanUrl);
    }
  }, [lanUrl, flash]);

  // ---- initial load (+ ?binderId= deep link from IQVault Portfolio) ----
  useEffect(() => {
    const params =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const deepBinderId = params?.get("binderId");
    jsonFetch<{ binders: ApiBinder[] }>("/api/binders")
      .then((d) => {
        setBinders(d.binders);
        if (!d.binders.length) return;
        const fromLink = deepBinderId
          ? d.binders.find((b) => b.id === deepBinderId)
          : null;
        setActiveBinderId((fromLink ?? d.binders[0]).id);
      })
      .catch(() => flash("Could not load binders"))
      .finally(() => setBooted(true));
  }, [flash]);

  useEffect(() => {
    jsonFetch<{ sets: SetOption[] }>("/api/cards/sets")
      .then((d) => {
        if (d.sets?.length) setSets(mergeSets(d.sets, SEED_SETS));
      })
      .catch(() => {
        /* keep SEED_SETS — picker stays usable offline / during API outages */
      });
  }, []);

  useEffect(() => {
    document.body.classList.toggle("printing-wishlist", !!wishlistPrint);
    return () => document.body.classList.remove("printing-wishlist");
  }, [wishlistPrint]);

  // Replace one binder in state with a fresh copy from the server.
  const applyBinder = useCallback((binder: ApiBinder) => {
    setBinders((prev) => {
      const idx = prev.findIndex((b) => b.id === binder.id);
      if (idx === -1) return [...prev, binder];
      const next = [...prev];
      next[idx] = binder;
      return next;
    });
  }, []);

  // ---- binder ops ----
  const createBinder = useCallback(async () => {
    const isEra = form.mode === "era";
    const payload = {
      name: form.name.trim() || (isEra ? eraName(form.eraKey) : "Untitled Binder"),
      spineColor: form.spineColor,
      rows: isEra ? 3 : form.rows,
      cols: isEra ? 3 : form.cols,
      template: isEra ? form.eraKey : null,
    };
    try {
      const { binder } = await jsonFetch<{ binder: ApiBinder }>("/api/binders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setBinders((prev) => [...prev, binder]);
      setActiveBinderId(binder.id);
      setActivePageIndex(0);
      setShowNewBinder(false);
      setForm(DEFAULT_FORM);
    } catch {
      flash("Failed to create binder");
    }
  }, [form, flash]);

  const renameBinder = useCallback(
    async (id: string, name: string) => {
      try {
        const { binder } = await jsonFetch<{ binder: ApiBinder }>(`/api/binders/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        applyBinder(binder);
      } catch {
        flash("Rename failed");
      }
    },
    [applyBinder, flash],
  );

  const deleteBinder = useCallback(
    async (id: string) => {
      try {
        await jsonFetch(`/api/binders/${id}`, { method: "DELETE" });
        setBinders((prev) => {
          const next = prev.filter((b) => b.id !== id);
          if (activeBinderId === id) {
            setActiveBinderId(next[0]?.id ?? null);
            setActivePageIndex(0);
          }
          return next;
        });
      } catch {
        flash("Delete failed");
      }
    },
    [activeBinderId, flash],
  );

  const addPage = useCallback(async () => {
    if (!activeBinder) return;
    try {
      const { binder } = await jsonFetch<{ binder: ApiBinder }>(
        `/api/binders/${activeBinder.id}/pages`,
        { method: "POST" },
      );
      applyBinder(binder);
      setActivePageIndex(binder.pages.length - 1);
    } catch {
      flash("Add page failed");
    }
  }, [activeBinder, applyBinder, flash]);

  const deletePage = useCallback(async () => {
    if (!activePage) return;
    try {
      const { binder } = await jsonFetch<{ binder: ApiBinder }>(`/api/pages/${activePage.id}`, {
        method: "DELETE",
      });
      applyBinder(binder);
      setActivePageIndex((i) => Math.max(0, Math.min(i, binder.pages.length - 1)));
    } catch {
      flash("Delete page failed");
    }
  }, [activePage, applyBinder, flash]);

  const openTransferPage = useCallback(
    (mode: "move" | "copy" = "move") => {
      if (!activeBinder || !activePage) return;
      const others = binders.filter((b) => b.id !== activeBinder.id);
      if (!others.length) {
        flash("Create another binder first, then move/copy this page into it");
        return;
      }
      // Move needs a second page in the source binder — fall back to Copy.
      const effective =
        mode === "move" && activeBinder.pages.length <= 1 ? "copy" : mode;
      setTransferMode(effective);
      setTransferTargetId(others[0]!.id);
      setShowTransferPage(true);
    },
    [activeBinder, activePage, binders, flash],
  );

  const confirmTransferPage = useCallback(async () => {
    if (!activePage || !transferTargetId) return;
    setTransferBusy(true);
    try {
      const res = await fetch(`/api/pages/${activePage.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetBinderId: transferTargetId,
          mode: transferMode,
        }),
      });
      const data = (await res.json()) as {
        sourceBinder?: ApiBinder;
        targetBinder?: ApiBinder;
        newPageId?: string;
        mode?: "move" | "copy";
        gridMismatch?: boolean;
        droppedCards?: number;
        error?: string;
      };
      if (!res.ok || !data.sourceBinder || !data.targetBinder || !data.newPageId) {
        flash(typeof data.error === "string" ? data.error : "Transfer failed");
        return;
      }
      applyBinder(data.sourceBinder);
      applyBinder(data.targetBinder);
      setActiveBinderId(data.targetBinder.id);
      const newIdx = data.targetBinder.pages.findIndex((p) => p.id === data.newPageId);
      setActivePageIndex(newIdx >= 0 ? newIdx : data.targetBinder.pages.length - 1);
      setShowTransferPage(false);

      let msg =
        data.mode === "move"
          ? `Moved page into ${data.targetBinder.name}`
          : `Copied page into ${data.targetBinder.name}`;
      if ((data.droppedCards ?? 0) > 0) {
        msg += ` — ${data.droppedCards} card(s) didn’t fit the target grid`;
      } else if (data.gridMismatch) {
        msg += " — pocket grid differs; cards mapped by slot index";
      }
      flash(msg);
    } catch {
      flash("Transfer failed");
    } finally {
      setTransferBusy(false);
    }
  }, [activePage, transferTargetId, transferMode, applyBinder, flash]);

  /**
   * One-time year backfill for this binder. Day-to-day prices come from the
   * existing Sync Prices / Refresh All buttons, which record history through
   * the same shared sync.
   */
  const backfillPriceHistory = useCallback(
    async () => {
      if (!activeBinder || updatingHistory) return;
      setUpdatingHistory(true);
      try {
        const report = await jsonFetch<{
          cardsConsidered: number;
          cardsPriced: number;
          cardsEmpty: number;
          cardsFailed: number;
          rowsWritten: number;
          rowsUpdated: number;
          newestObservedOn: string | null;
        }>("/api/prices/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ binderId: activeBinder.id, range: "annual" }),
        });

        const { binder } = await jsonFetch<{ binder: ApiBinder }>(
          `/api/binders/${activeBinder.id}`,
        );
        applyBinder(binder);

        if (report.cardsPriced === 0) {
          flash(
            report.cardsConsidered === 0
              ? "No TCGplayer-linked cards in this binder"
              : `No prices returned for ${report.cardsConsidered} card(s)`,
          );
        } else {
          flash(
            `Backfilled ${report.cardsPriced} card(s) — ` +
              `${report.rowsWritten} new day(s), ${report.rowsUpdated} refreshed` +
              (report.cardsFailed ? `, ${report.cardsFailed} failed` : "") +
              (report.newestObservedOn ? ` · through ${report.newestObservedOn}` : ""),
          );
        }
      } catch {
        flash("Price history update failed — is Postgres up?");
      } finally {
        setUpdatingHistory(false);
      }
    },
    [activeBinder, applyBinder, flash, updatingHistory],
  );

  const syncPagePrices = useCallback(
    async (force: boolean) => {
      if (!activeBinder || !activePage || syncingPrices) return;
      setSyncingPrices(true);
      try {
        const data = await jsonFetch<{
          binder: ApiBinder;
          report: {
            updated: number;
            unchanged: number;
            failed: number;
            slotsChecked: number;
            historyRowsNew: number;
            newestObservedOn: string | null;
          };
        }>(`/api/binders/${activeBinder.id}/sync-prices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageId: activePage.id, force }),
        });
        applyBinder(data.binder);
        const verb = force ? "Refreshed" : "Synced";
        flash(
          `${verb} prices — ${data.report.updated} updated, ${data.report.unchanged} unchanged` +
            (data.report.failed ? `, ${data.report.failed} failed` : "") +
            (data.report.historyRowsNew
              ? ` · +${data.report.historyRowsNew} history day(s)`
              : "") +
            (data.report.newestObservedOn
              ? ` · through ${data.report.newestObservedOn}`
              : ""),
        );
      } catch {
        flash("Price sync failed");
      } finally {
        setSyncingPrices(false);
      }
    },
    [activeBinder, activePage, applyBinder, flash, syncingPrices],
  );

  const syncOwnedFromVip = useCallback(async () => {
    if (!activeBinder || syncingOwned) return;
    setSyncingOwned(true);
    try {
      const data = await jsonFetch<{
        matched: number;
        markedOwned: number;
        alreadyOwned: number;
        vipExternalIds: number;
        binder: ApiBinder | null;
      }>("/api/sync-owned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ binderId: activeBinder.id }),
      });
      if (data.binder) applyBinder(data.binder);
      flash(
        `VIP owned sync — ${data.markedOwned} newly owned, ${data.alreadyOwned} already, ` +
          `${data.matched} matched / ${data.vipExternalIds} VIP ids`,
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : "VIP owned sync failed");
    } finally {
      setSyncingOwned(false);
    }
  }, [activeBinder, applyBinder, flash, syncingOwned]);

  /** Binder → VIP: write owned/wishlist flags into durable VIP holdings + watchlist. */
  const pushToVip = useCallback(async () => {
    if (!activeBinder || pushingVip) return;
    setPushingVip(true);
    try {
      const data = await jsonFetch<{
        slots: number;
        holdingsUpserted: number;
        holdingsDeleted: number;
        watchlistUpserted: number;
        watchlistDeleted: number;
      }>("/api/push-vip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ binderId: activeBinder.id }),
      });
      flash(
        `Pushed to VIP — ${data.holdingsUpserted} owned holdings, ` +
          `${data.watchlistUpserted} wishlist · ${data.slots} slots scanned`,
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : "Push to VIP failed");
    } finally {
      setPushingVip(false);
    }
  }, [activeBinder, flash, pushingVip]);

  const reorderPages = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!activeBinder || fromIndex === toIndex) return;
      if (fromIndex < 0 || toIndex < 0) return;
      if (fromIndex >= activeBinder.pages.length || toIndex >= activeBinder.pages.length) return;

      const ids = activeBinder.pages.map((p) => p.id);
      const [moved] = ids.splice(fromIndex, 1);
      if (!moved) return;
      ids.splice(toIndex, 0, moved);

      // Optimistic UI: keep the dragged page under the cursor.
      const activeId = activeBinder.pages[activePageIndex]?.id;
      const optimisticPages = ids.map((id, i) => {
        const page = activeBinder.pages.find((p) => p.id === id)!;
        return { ...page, pageIndex: i };
      });
      applyBinder({ ...activeBinder, pages: optimisticPages });
      if (activeId) {
        const nextIdx = ids.indexOf(activeId);
        if (nextIdx >= 0) setActivePageIndex(nextIdx);
      }

      try {
        const { binder } = await jsonFetch<{ binder: ApiBinder }>(
          `/api/binders/${activeBinder.id}/pages`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageIds: ids }),
          },
        );
        applyBinder(binder);
        if (activeId) {
          const nextIdx = binder.pages.findIndex((p) => p.id === activeId);
          if (nextIdx >= 0) setActivePageIndex(nextIdx);
        }
      } catch {
        // Reload binder on failure so indexes stay honest.
        try {
          const { binder } = await jsonFetch<{ binder: ApiBinder }>(
            `/api/binders/${activeBinder.id}`,
          );
          applyBinder(binder);
        } catch {
          /* ignore */
        }
        flash("Could not reorder pages");
      }
    },
    [activeBinder, activePageIndex, applyBinder, flash],
  );

  const savePageMeta = useCallback(
    async (pageId: string, patch: { title?: string; subtitle?: string }) => {
      try {
        const { binder } = await jsonFetch<{ binder: ApiBinder }>(`/api/pages/${pageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        applyBinder(binder);
      } catch {
        flash("Could not save page name");
      }
    },
    [applyBinder, flash],
  );

  const commitBinderName = useCallback(
    (raw: string) => {
      if (!activeBinder) return;
      const v = raw.trim();
      if (!v || v === activeBinder.name) return;
      renameBinder(activeBinder.id, v);
    },
    [activeBinder, renameBinder],
  );

  const commitPageTitle = useCallback(
    (raw: string) => {
      if (!activePage) return;
      const v = raw.trim() || `Page ${activePageIndex + 1}`;
      if (v === activePage.title) return;
      savePageMeta(activePage.id, { title: v });
    },
    [activePage, activePageIndex, savePageMeta],
  );

  const commitPageSubtitle = useCallback(
    (raw: string) => {
      if (!activePage) return;
      if (raw === activePage.subtitle) return;
      savePageMeta(activePage.id, { subtitle: raw });
    },
    [activePage, savePageMeta],
  );

  // ---- slot ops ----
  const placeCard = useCallback(
    async (slotId: string, card: CardResult) => {
      try {
        const { binder } = await jsonFetch<{ binder: ApiBinder }>(`/api/slots/${slotId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "card", card }),
        });
        applyBinder(binder);
        setSearchOpen(false);
        setMoveFromSlotId(null);
      } catch {
        flash("Could not place card");
      }
    },
    [applyBinder, flash],
  );

  const moveCard = useCallback(
    async (targetSlotId: string, fromSlotId: string) => {
      if (targetSlotId === fromSlotId) return;
      try {
        const { binder } = await jsonFetch<{ binder: ApiBinder }>(`/api/slots/${targetSlotId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "move", fromSlotId }),
        });
        applyBinder(binder);
      } catch {
        flash("Move failed");
      }
    },
    [applyBinder, flash],
  );

  const clearSlot = useCallback(
    async (slotId: string) => {
      try {
        const { binder } = await jsonFetch<{ binder: ApiBinder }>(`/api/slots/${slotId}`, {
          method: "DELETE",
        });
        applyBinder(binder);
      } catch {
        flash("Remove failed");
      }
    },
    [applyBinder, flash],
  );

  const toggleWishlist = useCallback(
    async (slotId: string, onWishlist: boolean) => {
      try {
        const { binder } = await jsonFetch<{ binder: ApiBinder }>(
          `/api/slots/${slotId}/wishlist`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ onWishlist }),
          },
        );
        applyBinder(binder);
      } catch {
        flash("Could not update wishlist");
      }
    },
    [applyBinder, flash],
  );

  const toggleOwned = useCallback(
    async (slotId: string, owned: boolean) => {
      try {
        const { binder } = await jsonFetch<{ binder: ApiBinder }>(`/api/slots/${slotId}/owned`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owned }),
        });
        applyBinder(binder);
      } catch {
        flash("Could not update owned status");
      }
    },
    [applyBinder, flash],
  );

  // Drop stale selections when switching binder / page / scope.
  useEffect(() => {
    setValueSelected(new Set());
  }, [activeBinderId, activePageIndex, valueScope]);

  const exportWishlistPdf = useCallback(async () => {
    if (!activeBinder && wishlistForm.scope === "binder") {
      flash("Open a binder first");
      return;
    }
    setWishlistPrinting(true);
    try {
      const { items, generatedAt } = await jsonFetch<{
        items: WishlistItem[];
        generatedAt: number;
        count: number;
      }>("/api/wishlist/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          binderId: wishlistForm.scope === "binder" ? activeBinder?.id ?? null : null,
          starredOnly: wishlistForm.starredOnly,
          includeImages: wishlistForm.includeImages,
          includePrices: wishlistForm.includePrices,
          note: wishlistForm.note,
          contactName: wishlistForm.contactName,
        }),
      });
      if (!items.length) {
        flash(
          wishlistForm.starredOnly
            ? "No starred cards yet — tap ★ on pockets first"
            : "No filled cards in that scope",
        );
        return;
      }
      setWishlistPrint({
        items,
        includeImages: wishlistForm.includeImages,
        includePrices: wishlistForm.includePrices,
        contactName: wishlistForm.contactName.trim(),
        note: wishlistForm.note.trim(),
        title:
          wishlistForm.scope === "binder" && activeBinder
            ? `${activeBinder.name} — Wishlist`
            : "Binder Vault Wishlist",
        generatedAt,
      });
      setShowWishlistExport(false);
      // Let the print sheet paint before opening the system print dialog.
      window.setTimeout(() => window.print(), 80);
    } catch {
      flash("Wishlist export failed");
    } finally {
      setWishlistPrinting(false);
    }
  }, [activeBinder, flash, wishlistForm]);

  const uploadToSlot = useCallback(
    async (slotId: string, file: File) => {
      if (!file.type.startsWith("image/")) return flash("Only image files");
      try {
        const fd = new FormData();
        fd.append("file", file);
        const { imageLocal } = await jsonFetch<{ imageLocal: string }>("/api/media", {
          method: "POST",
          body: fd,
        });
        const { binder } = await jsonFetch<{ binder: ApiBinder }>(`/api/slots/${slotId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "upload", imageLocal, cardName: file.name }),
        });
        applyBinder(binder);
      } catch {
        flash("Upload failed");
      }
    },
    [applyBinder, flash],
  );

  // hidden file input for click-to-upload
  const openFilePicker = useCallback((slotId: string) => {
    uploadTargetRef.current = slotId;
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const slotId = uploadTargetRef.current;
      if (file && slotId) uploadToSlot(slotId, file);
      e.target.value = "";
      uploadTargetRef.current = null;
    },
    [uploadToSlot],
  );

  // ---- drag + drop onto a pocket ----
  const onPocketDrop = useCallback(
    (e: React.DragEvent, slot: ApiSlot) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).classList.remove("dragover");
      // Ignore page-tab reorder payloads landing on the grid.
      if (e.dataTransfer.types.includes("text/page-index")) return;

      const file = e.dataTransfer.files?.[0];
      if (file) {
        uploadToSlot(slot.id, file);
        return;
      }
      const raw = readDragPayload(e);
      if (!raw) {
        flash("Drop failed — try clicking the card instead");
        return;
      }
      try {
        const payload = JSON.parse(raw) as
          | { type: "card"; card: CardResult }
          | { type: "slot"; slotId: string };
        if (payload.type === "card") placeCard(slot.id, payload.card);
        else if (payload.type === "slot") moveCard(slot.id, payload.slotId);
      } catch {
        flash("Drop failed — try clicking the card instead");
      }
    },
    [placeCard, moveCard, uploadToSlot, flash],
  );

  // ---- card search (debounced) ----
  useEffect(() => {
    const q = query.trim();
    const canSearch = q.length >= 2 || hasSearchFilters;
    if (!canSearch) {
      setResults([]);
      setSearchNote("");
      return;
    }
    // All chips off → nothing can match the OR rarity filter.
    if (noRaritiesOn) {
      setResults([]);
      setSearchNote("Turn on at least one rarity / type.");
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        // Set browse must request the full set — promo sets exceed the old 60/250 caps.
        const params = new URLSearchParams({
          source: setFilter ? "pokemontcg" : source,
          limit: setFilter ? "500" : "40",
        });
        if (q) params.set("q", q);
        if (setFilter) params.set("set", setFilter);
        // All-on = no rarity restriction. Subset = OR match any selected chip.
        if (rarityNarrowed) params.set("rarity", rarityFilters.join(","));
        const data = await jsonFetch<{ results: CardResult[]; errors: string[] }>(
          `/api/cards/search?${params}`,
        );
        setResults(data.results);
        const setNote =
          setFilter && data.results.length
            ? `${data.results.length} card${data.results.length === 1 ? "" : "s"} in set`
            : "";
        setSearchNote(
          data.results.length
            ? setNote
            : data.errors.length
              ? "Source error — try again or switch source."
              : "No cards found for those filters.",
        );
      } catch {
        setSearchNote("Search failed.");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [query, source, setFilter, rarityFilters, hasSearchFilters, noRaritiesOn, rarityNarrowed]);

  const placeInFirstEmpty = useCallback(
    (card: CardResult) => {
      if (!activeBinder) return flash("Create a binder first");
      // Prefer current page, then scan the rest — no binder size cap.
      const order = [
        activePageIndex,
        ...activeBinder.pages.map((_, i) => i).filter((i) => i !== activePageIndex),
      ];
      for (const pageIdx of order) {
        const page = activeBinder.pages[pageIdx];
        if (!page) continue;
        const empty = page.slots.find((s) => !s.card);
        if (empty) {
          if (pageIdx !== activePageIndex) {
            setActivePageIndex(pageIdx);
            flash(`Placed on page ${pageIdx + 1} (this page was full)`);
          }
          placeCard(empty.id, card);
          return;
        }
      }
      flash("Binder is full — click + Add Page for more pockets");
    },
    [activeBinder, activePageIndex, placeCard, flash],
  );

  const onPocketTap = useCallback(
    (slot: ApiSlot) => {
      if (!slot.card) {
        if (moveFromSlotId) {
          moveCard(slot.id, moveFromSlotId);
          setMoveFromSlotId(null);
          return;
        }
        openFilePicker(slot.id);
        return;
      }
      if (moveFromSlotId) {
        if (moveFromSlotId === slot.id) {
          setMoveFromSlotId(null);
          return;
        }
        moveCard(slot.id, moveFromSlotId);
        setMoveFromSlotId(null);
        return;
      }
      // Start touch/click rearrange (desktop can still drag).
      setMoveFromSlotId(slot.id);
      flash("Tap another pocket to move/swap — tap again to cancel");
    },
    [moveFromSlotId, moveCard, openFilePicker, flash],
  );

  // ---- render ----
  return (
    <div className={`app ${searchOpen ? "search-open" : ""} ${mobileMenuOpen ? "menu-open" : ""}`}>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileInputChange} />

      <div className="lan-bar" role="note">
        <span className="lan-bar-text">
          Phone (same Wi‑Fi): open this host on port 3010 · VIP API :8787
        </span>
        <button type="button" className="btn btn-ghost lan-copy" onClick={copyLanUrl}>
          Copy URL
        </button>
      </div>

      <button
        type="button"
        className="mobile-nav-btn"
        aria-label="Open binders"
        onClick={() => setMobileMenuOpen((v) => !v)}
      >
        ☰
      </button>
      <button
        type="button"
        className="mobile-search-btn"
        aria-label="Open card search"
        onClick={() => setSearchOpen((v) => !v)}
      >
        {searchOpen ? "Close" : "Search"}
      </button>

      {/* SHELF */}
      <aside className={`shelf ${mobileMenuOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">BV</div>
          <div>
            <div className="brand-title">Binder Vault</div>
            <div className="eyebrow brand-sub">Your collection, shelved</div>
          </div>
        </div>

        <div className="spines">
          {binders.length === 0 && (
            <div className="shelf-empty eyebrow">
              {booted ? "No binders yet" : "Loading…"}
            </div>
          )}
          {binders.map((b) => (
            <div
              key={b.id}
              className={`spine ${b.id === activeBinderId ? "active" : ""}`}
              onClick={() => {
                setActiveBinderId(b.id);
                setActivePageIndex(0);
                setMobileMenuOpen(false);
              }}
              role="button"
              tabIndex={0}
            >
              <div className="spine-bar" style={{ background: b.spineColor }} />
              <div>
                <div className="spine-label">{b.name}</div>
                <div className="spine-meta">
                  {b.pages.length} PG · {b.rows}×{b.cols}
                  {b.template ? " · era" : ""}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button className="btn btn-primary" onClick={() => setShowNewBinder(true)}>
          + New Binder
        </button>
      </aside>

      {/* MAIN */}
      <main className="main">
        <div className="topbar">
          {activeBinder ? (
            <div className="name-field">
              <label htmlFor="binder-name-input">Binder name</label>
              <input
                id="binder-name-input"
                className="binder-name"
                defaultValue={activeBinder.name}
                key={activeBinder.id + activeBinder.name}
                placeholder="Name this binder…"
                title="Click to rename this binder"
                onBlur={(e) => commitBinderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            </div>
          ) : (
            <div className="binder-name" style={{ color: "var(--muted)" }}>
              Binder Vault
            </div>
          )}

          {activeBinder && (
            <>
              <div className="pager">
                <button
                  className="btn btn-ghost"
                  disabled={activePageIndex === 0}
                  onClick={() => setActivePageIndex((i) => Math.max(0, i - 1))}
                >
                  ‹ Prev
                </button>
                <div className="pager-count">
                  PAGE {activePageIndex + 1} OF {activeBinder.pages.length}
                </div>
                <button
                  className="btn btn-ghost"
                  disabled={activePageIndex >= activeBinder.pages.length - 1}
                  onClick={() =>
                    setActivePageIndex((i) => Math.min(activeBinder.pages.length - 1, i + 1))
                  }
                >
                  Next ›
                </button>
              </div>

              <div className="topbar-actions">
                <button
                  type="button"
                  className="btn mobile-only"
                  onClick={() => setSearchOpen(true)}
                >
                  Cards
                </button>
                <button className="btn" onClick={addPage}>
                  + Add Page
                </button>
                <button
                  className="btn"
                  disabled={activeBinder.pages.length <= 1}
                  onClick={deletePage}
                >
                  Delete Page
                </button>
                <button
                  className="btn"
                  onClick={() => openTransferPage("move")}
                  title="Move or copy this page into another binder"
                  disabled={binders.length < 2}
                >
                  Move / Copy Page
                </button>
                <span className="topbar-asof" title="Newest successful Near Mint price on this page">
                  {pagePricesAsOf}
                </span>
                <button
                  className="btn"
                  disabled={syncingPrices}
                  onClick={() => void syncPagePrices(false)}
                  title="Fetch Near Mint TCGplayer prices for this page and record them in price history"
                >
                  {syncingPrices ? "Syncing…" : "Sync Prices"}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={syncingPrices}
                  onClick={() => void syncPagePrices(true)}
                  title="Re-fetch Near Mint prices for every TCGplayer-linked card on this page and record today's history"
                >
                  Refresh All
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={updatingHistory}
                  onClick={() => void backfillPriceHistory()}
                  title="One-time: pull about a year of weekly price history for every card in this binder"
                >
                  {updatingHistory ? "Backfilling…" : "Backfill 1 yr History"}
                </button>
                <button
                  type="button"
                  className="btn ledger-toggle"
                  aria-pressed={ledgerOpen}
                  onClick={() => setLedgerOpen((open) => !open)}
                  title="Show or hide the Ledger (hidden on narrow windows)"
                >
                  {ledgerOpen ? "Hide Ledger" : "Ledger"}
                </button>
                <button
                  className="btn"
                  disabled={syncingOwned}
                  onClick={syncOwnedFromVip}
                  title="Mark pockets owned when they match VIP inventory external ids"
                >
                  {syncingOwned ? "Syncing…" : "Sync Owned (VIP)"}
                </button>
                <button
                  className="btn"
                  disabled={pushingVip}
                  onClick={() => void pushToVip()}
                  title="Write this binder's owned + wishlist flags into durable VIP holdings / watchlist"
                >
                  {pushingVip ? "Pushing…" : "Push to VIP"}
                </button>
                <button
                  type="button"
                  className={`btn ${highlightMissing ? "btn-on" : ""}`}
                  onClick={toggleHighlightMissing}
                  aria-pressed={highlightMissing}
                  title={
                    highlightMissing
                      ? "Highlight missing on — owned cards are faded so needs stand out"
                      : "Highlight missing off — show all cards at full strength"
                  }
                >
                  {highlightMissing ? "Highlight Missing: On" : "Highlight Missing"}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setWishlistForm((f) => ({ ...f, scope: "binder" }));
                    setShowWishlistExport(true);
                  }}
                  title="Build a store wishlist PDF from starred (or all) cards"
                >
                  Export Wishlist
                </button>
                <button className="btn" onClick={() => window.print()}>
                  Print Page
                </button>
                <button className="btn btn-danger" onClick={() => deleteBinder(activeBinder.id)}>
                  Delete Binder
                </button>
              </div>
            </>
          )}
        </div>

        {activeBinder && (
          <div className="page-strip" aria-label="Binder pages — drag tabs to reorder">
            {activeBinder.pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                draggable
                className={`page-tab ${i === activePageIndex ? "active" : ""}`}
                onClick={() => setActivePageIndex(i)}
                title={`${p.title || `Page ${i + 1}`} — drag to reorder`}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/page-index", String(i));
                  e.dataTransfer.effectAllowed = "move";
                  (e.currentTarget as HTMLElement).classList.add("dragging");
                }}
                onDragEnd={(e) => {
                  (e.currentTarget as HTMLElement).classList.remove("dragging");
                  document
                    .querySelectorAll(".page-tab.drag-over")
                    .forEach((el) => el.classList.remove("drag-over"));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  (e.currentTarget as HTMLElement).classList.add("drag-over");
                }}
                onDragLeave={(e) => {
                  (e.currentTarget as HTMLElement).classList.remove("drag-over");
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).classList.remove("drag-over");
                  const from = Number(e.dataTransfer.getData("text/page-index"));
                  if (Number.isNaN(from)) return;
                  reorderPages(from, i);
                }}
              >
                <span className="page-tab-grip" aria-hidden>
                  ⋮⋮
                </span>
                <span className="page-tab-index">{i + 1}</span>
                {p.title.trim() || `Page ${i + 1}`}
              </button>
            ))}
            <span className="page-strip-hint">Drag tabs to reorder · Move / Copy Page for other binders</span>
          </div>
        )}

        <div className="workspace">
          <div className="stage">
            {!activeBinder || !activePage ? (
              <div className="empty-state">
                <h2>No binder open</h2>
                <p>
                  Create a binder on the left — pick a pocket layout (9, 12, 4, 20 or custom) or a
                  themed era page — then drag cards from the search dock, or drop image files
                  straight from your computer into any pocket. Everything saves to your local
                  SQLite vault.
                </p>
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 14 }}
                  onClick={() => setShowNewBinder(true)}
                >
                  + Create your first binder
                </button>
              </div>
            ) : (
              <div className="stage-spread">
                <button
                  type="button"
                  className="page-side-nav"
                  disabled={activePageIndex === 0}
                  onClick={() => setActivePageIndex((i) => Math.max(0, i - 1))}
                  title="Previous page"
                  aria-label="Previous page"
                >
                  <span aria-hidden>‹</span>
                  <em>
                    {activePageIndex === 0
                      ? "Start"
                      : activeBinder.pages[activePageIndex - 1]?.title.trim() ||
                        `Page ${activePageIndex}`}
                  </em>
                </button>
              <div className="page-wrap">
                <div
                  className="page"
                  style={{
                    width: `${activeBinder.cols * 140 + (activeBinder.cols - 1) * 14 + 88}px`,
                    maxWidth: "calc(100vw - 980px)",
                  }}
                >
                  <div className="page-header">
                    <div className="page-name-fields">
                      <div>
                        <label htmlFor="page-title-input">Page name</label>
                        <input
                          id="page-title-input"
                          className="page-title"
                          defaultValue={activePage.title}
                          key={`${activePage.id}-title-${activePage.title}`}
                          placeholder="Name this page…"
                          title="Click to rename this page"
                          onBlur={(e) => commitPageTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                        />
                      </div>
                      <div>
                        <label htmlFor="page-subtitle-input">Subtitle (optional)</label>
                        <input
                          id="page-subtitle-input"
                          className="page-subtitle"
                          defaultValue={activePage.subtitle}
                          key={`${activePage.id}-sub-${activePage.subtitle}`}
                          placeholder="Theme note, set, or hunt…"
                          onBlur={(e) => commitPageSubtitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                        />
                      </div>
                    </div>
                    {activePage.slots.some((s) => s.isCenter) && (
                      <div className="chase-badge">Center = Chase #1</div>
                    )}
                  </div>
                  <div className="tone-bar" style={{ background: activePage.tone }} />

                  <div className="ring-col">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="ring-hole" />
                    ))}
                  </div>

                  <div
                    className={`grid ${highlightMissing ? "highlight-missing" : ""}`}
                    style={{ gridTemplateColumns: `repeat(${activeBinder.cols}, 1fr)` }}
                  >
                    {activePage.slots.map((slot) => (
                      <Pocket
                        key={slot.id}
                        slot={slot}
                        cols={activeBinder.cols}
                        highlightMissing={highlightMissing}
                        selectedForMove={moveFromSlotId === slot.id}
                        onDrop={onPocketDrop}
                        onTap={onPocketTap}
                        onView={(src, meta) => setLightbox({ src, meta })}
                        onRemove={clearSlot}
                        onToggleWishlist={toggleWishlist}
                        onToggleOwned={toggleOwned}
                      />
                    ))}
                  </div>
                </div>
                <div className="page-caption">
                  {activeBinder.name.toUpperCase()} —{" "}
                  {(activePage.title || `Page ${activePageIndex + 1}`).toUpperCase()} ·{" "}
                  {activeBinder.rows}×{activeBinder.cols}
                  {highlightMissing
                    ? " · highlighting needs (owned faded)"
                    : " · drag cards between pockets to rearrange"}
                </div>
              </div>
                <button
                  type="button"
                  className="page-side-nav"
                  disabled={activePageIndex >= activeBinder.pages.length - 1}
                  onClick={() =>
                    setActivePageIndex((i) =>
                      Math.min(activeBinder.pages.length - 1, i + 1),
                    )
                  }
                  title="Next page"
                  aria-label="Next page"
                >
                  <span aria-hidden>›</span>
                  <em>
                    {activePageIndex >= activeBinder.pages.length - 1
                      ? "End"
                      : activeBinder.pages[activePageIndex + 1]?.title.trim() ||
                        `Page ${activePageIndex + 2}`}
                  </em>
                </button>
              </div>
            )}
          </div>

          {activeBinder && activePage && (
            <ValueRail
              binder={activeBinder}
              pageIndex={activePageIndex}
              cols={activeBinder.cols}
              scope={valueScope}
              onScope={setValueScope}
              selected={valueSelected}
              onSelected={setValueSelected}
              onToggleOwned={toggleOwned}
              onJumpPage={setActivePageIndex}
              onBackfillHistory={backfillPriceHistory}
              updatingHistory={updatingHistory}
              open={ledgerOpen}
            />
          )}

          {/* SEARCH DOCK */}
          {searchOpen && (
            <button
              type="button"
              className="search-backdrop"
              aria-label="Close search"
              onClick={() => setSearchOpen(false)}
            />
          )}
          <aside className={`search-dock ${searchOpen ? "open" : ""}`}>
            <div className="search-head">
              <div className="search-title">Card Search</div>
              <input
                className="search-input"
                placeholder="Search Pokémon cards… e.g. Charizard"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="source-tabs">
                {(["all", "pokemontcg", "tcgdex"] as CardSource[]).map((s) => (
                  <div
                    key={s}
                    className={`source-tab ${source === s ? "active" : ""}`}
                    onClick={() => setSource(s)}
                  >
                    {s === "all" ? "All" : s === "pokemontcg" ? "TCG.io" : "TCGdex"}
                  </div>
                ))}
              </div>

              <div className="search-filters">
                <div className="filter-row">
                  <label>Set</label>
                  <div className="quick-set-chips">
                    {QUICK_SET_CHIPS.map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        className={`rarity-chip ${setFilter === chip.id ? "active" : ""}`}
                        onClick={() =>
                          setSetFilter((prev) => (prev === chip.id ? "" : chip.id))
                        }
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  <SetPicker
                    sets={sets}
                    value={setFilter}
                    onChange={setSetFilter}
                  />
                </div>

                <div className="filter-row">
                  <label>
                    Rarity / type
                    <span className="filter-hint">match any on</span>
                  </label>
                  <div className="rarity-chips">
                    {RARITY_FILTERS.map((r) => {
                      const active = rarityFilters.includes(r.key);
                      return (
                        <button
                          key={r.key}
                          type="button"
                          className={`rarity-chip ${active ? "active" : ""}`}
                          title={`${r.rarities.join(", ")} — on = include (OR)`}
                          aria-pressed={active}
                          onClick={() =>
                            setRarityFilters((prev) =>
                              prev.includes(r.key)
                                ? prev.filter((k) => k !== r.key)
                                : [...prev, r.key],
                            )
                          }
                        >
                          {r.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {hasSearchFilters && (
                  <button
                    type="button"
                    className="filter-clear"
                    onClick={() => {
                      setSetFilter("");
                      setRarityFilters([...ALL_RARITY_KEYS]);
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>

              <div className="search-hint">
                Tap a set chip, type a set name, or search a card. Toggle rarities off to narrow —
                a card shows if it matches any type still on. Drag into a pocket — or click to fill
                the first empty slot.
              </div>
            </div>

            <div className="results">
              {searching && <div className="spinner" />}
              {!searching && searchNote && <div className="results-status">{searchNote}</div>}
              {!searching && !searchNote && results.length === 0 && (
                <div className="results-status">
                  Type a name (2+ chars), or pick a Set / rarity filter to browse.
                </div>
              )}
              {results.map((card) => (
                <ResultCard
                  key={`${card.source}-${card.externalId}`}
                  card={card}
                  onClick={placeInFirstEmpty}
                />
              ))}
            </div>
          </aside>
        </div>
      </main>

      {showNewBinder && (
        <NewBinderModal
          form={form}
          setForm={setForm}
          onCancel={() => setShowNewBinder(false)}
          onCreate={createBinder}
        />
      )}

      {showWishlistExport && (
        <WishlistExportModal
          form={wishlistForm}
          setForm={setWishlistForm}
          binderName={activeBinder?.name ?? null}
          busy={wishlistPrinting}
          onCancel={() => setShowWishlistExport(false)}
          onExport={exportWishlistPdf}
        />
      )}

      {showTransferPage && activeBinder && activePage && (
        <TransferPageModal
          pageTitle={activePage.title.trim() || `Page ${activePageIndex + 1}`}
          sourceBinder={activeBinder}
          targets={binders.filter((b) => b.id !== activeBinder.id)}
          mode={transferMode}
          targetId={transferTargetId}
          busy={transferBusy}
          onMode={setTransferMode}
          onTarget={setTransferTargetId}
          onCancel={() => setShowTransferPage(false)}
          onConfirm={confirmTransferPage}
        />
      )}

      {wishlistPrint && (
        <WishlistPrintSheet
          payload={wishlistPrint}
          onDone={() => setWishlistPrint(null)}
        />
      )}

      {lightbox && (
        <div
          className="lightbox"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightbox(null);
          }}
        >
          <button className="lightbox-close" onClick={() => setLightbox(null)}>
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.src} alt="Full resolution card" />
          <div className="lightbox-meta">{lightbox.meta}</div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function eraName(key: string): string {
  return ERA_TEMPLATES.find((e) => e.key === key)?.name ?? "Era Binder";
}

function ValueRail({
  binder,
  pageIndex,
  cols,
  scope,
  onScope,
  selected,
  onSelected,
  onToggleOwned,
  onJumpPage,
  onBackfillHistory,
  updatingHistory,
  open,
}: {
  binder: ApiBinder;
  pageIndex: number;
  cols: number;
  scope: "page" | "binder";
  onScope: (s: "page" | "binder") => void;
  selected: Set<string>;
  onSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  onToggleOwned: (slotId: string, owned: boolean) => void;
  onJumpPage: (pageIndex: number) => void;
  onBackfillHistory: () => void;
  updatingHistory: boolean;
  open: boolean;
}) {
  const lines = useMemo(
    () => collectValueLines(binder, scope, pageIndex),
    [binder, scope, pageIndex],
  );
  const totals = useMemo(() => computeValueTotals(lines, selected), [lines, selected]);
  const pricesAsOf = useMemo(
    () => formatPriceAsOf(maxPriceUpdatedAt(binder, scope, pageIndex)),
    [binder, scope, pageIndex],
  );
  const selecting = selected.size > 0;

  const toggleSelect = (slotId: string) => {
    onSelected((prev) => {
      // Empty set means "all in scope". First uncheck materializes the full set.
      if (prev.size === 0) {
        const next = new Set(lines.map((l) => l.slotId));
        next.delete(slotId);
        return next;
      }
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      if (next.size === 0 || next.size === lines.length) return new Set();
      return next;
    });
  };

  return (
    <aside className={`value-rail${open ? " open" : ""}`} aria-label="Page and binder value calculator">
      <div className="value-rail-head">
        <div className="value-rail-title">Ledger</div>
        <div className="source-tabs">
          <div
            className={`source-tab ${scope === "page" ? "active" : ""}`}
            onClick={() => onScope("page")}
          >
            Page
          </div>
          <div
            className={`source-tab ${scope === "binder" ? "active" : ""}`}
            onClick={() => onScope("binder")}
          >
            Binder
          </div>
        </div>
      </div>

      <div className="value-calc">
        <div className="value-calc-row">
          <span>Total market</span>
          <strong>{formatUsd(totals.totalMarket)}</strong>
        </div>
        <div className="value-calc-row owned">
          <span>Owned ({totals.ownedCount})</span>
          <strong>{formatUsd(totals.ownedMarket)}</strong>
        </div>
        <div className="value-calc-row need">
          <span>Still need ({totals.needCount})</span>
          <strong>{formatUsd(totals.needMarket)}</strong>
        </div>
        <div className={`value-calc-row delta ${totals.delta >= 0 ? "pos" : "neg"}`}>
          <span>Delta</span>
          <strong>
            {totals.delta >= 0 ? "+" : ""}
            {formatUsd(totals.delta)}
          </strong>
        </div>
        <div className="value-calc-note">
          {selecting
            ? `${totals.count} selected · `
            : `${totals.count} cards · `}
          {totals.unpricedCount
            ? `${totals.unpricedCount} missing price (count as $0)`
            : "all priced"}
          {" · "}
          ranges not point facts
        </div>
        <div className="value-calc-note value-calc-asof" title="Newest successful price observation in this scope">
          {pricesAsOf}
        </div>
        <div className="value-price-actions">
          <button
            type="button"
            className="btn btn-ghost value-tool-btn"
            disabled={updatingHistory}
            onClick={() => onBackfillHistory()}
            title="One-time: pull about a year of weekly price history for every card in this binder. Day-to-day prices come from Sync Prices / Refresh All."
          >
            {updatingHistory ? "Backfilling…" : "Backfill 1 yr History"}
          </button>
        </div>
      </div>

      <div className="value-list-tools">
        <button
          type="button"
          className="btn btn-ghost value-tool-btn"
          onClick={() => onSelected(new Set(lines.map((l) => l.slotId)))}
        >
          Select all
        </button>
        <button
          type="button"
          className="btn btn-ghost value-tool-btn"
          onClick={() => onSelected(new Set())}
          title="Clear selection — totals use every card in scope"
        >
          All in scope
        </button>
      </div>

      <ul className="value-list">
        {lines.length === 0 && (
          <li className="value-list-empty">No cards in this {scope} yet.</li>
        )}
        {lines.map((line) => (
          <ValueListRow
            key={line.slotId}
            line={line}
            cols={cols}
            checked={selecting ? selected.has(line.slotId) : true}
            dimmed={selecting && !selected.has(line.slotId)}
            showPage={scope === "binder"}
            onToggleSelect={() => toggleSelect(line.slotId)}
            onToggleOwned={() => onToggleOwned(line.slotId, !line.owned)}
            onJump={() => onJumpPage(line.pageIndex)}
          />
        ))}
      </ul>
    </aside>
  );
}

function ValueListRow({
  line,
  cols,
  checked,
  dimmed,
  showPage,
  onToggleSelect,
  onToggleOwned,
  onJump,
}: {
  line: ValueLine;
  cols: number;
  checked: boolean;
  dimmed: boolean;
  showPage: boolean;
  onToggleSelect: () => void;
  onToggleOwned: () => void;
  onJump: () => void;
}) {
  const setNum = [line.setName, line.number ? `#${line.number}` : null].filter(Boolean).join(" ");
  return (
    <li className={`value-row ${dimmed ? "dimmed" : ""} ${line.owned ? "is-owned" : "is-need"}`}>
      <label className="value-check">
        <input type="checkbox" checked={checked} onChange={onToggleSelect} />
      </label>
      <button type="button" className="value-row-main" onClick={onJump} title="Go to page">
        <div className="value-row-name">
          {line.name}
          {line.onWishlist ? <span className="value-star">★</span> : null}
        </div>
        <div className="value-row-meta">
          {showPage ? <span>{line.pageTitle}</span> : null}
          <span>{pocketCoord(line.slotIndex, cols)}</span>
          {setNum ? <span>{setNum}</span> : null}
          {line.rarity ? <span>{line.rarity}</span> : null}
        </div>
      </button>
      <div className="value-row-side">
        <button
          type="button"
          className={`value-own-btn ${line.owned ? "on" : ""}`}
          onClick={onToggleOwned}
          title={line.owned ? "Owned — click to mark need" : "Need — click to mark owned"}
        >
          {line.owned ? "Own" : "Need"}
        </button>
        <div className="value-row-price">
          {line.priceMarket != null ? formatUsd(line.priceMarket) : "—"}
        </div>
      </div>
    </li>
  );
}

/** Typeahead set picker — local filter over seed/cache/live catalog. */
function SetPicker({
  sets,
  value,
  onChange,
}: {
  sets: SetOption[];
  value: string;
  onChange: (setId: string) => void;
}) {
  const selected = sets.find((s) => s.id === value) ?? null;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selected) setText(setLabel(selected));
    else if (!value) setText("");
  }, [selected, value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const suggestions = useMemo(() => {
    if (!open) return [];
    // If the field still shows the selected label, browse newest sets instead
    // of filtering against the full "Name · Series" string.
    const browse = selected && text === setLabel(selected);
    return filterSets(sets, browse ? "" : text, 30);
  }, [sets, text, open, selected]);

  return (
    <div className="set-picker" ref={wrapRef}>
      <div className="set-picker-row">
        <input
          className="filter-select set-picker-input"
          placeholder="Type a set… e.g. Ascended, Prismatic, 151"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            if (!e.target.value.trim() && value) onChange("");
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Enter" && suggestions[0]) {
              e.preventDefault();
              onChange(suggestions[0].id);
              setText(setLabel(suggestions[0]));
              setOpen(false);
            }
          }}
          aria-autocomplete="list"
          aria-expanded={open}
        />
        {value && (
          <button
            type="button"
            className="set-picker-clear"
            title="Clear set filter"
            onClick={() => {
              onChange("");
              setText("");
              setOpen(false);
            }}
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <ul className="set-picker-menu" role="listbox">
          <li>
            <button
              type="button"
              className={!value ? "active" : ""}
              onClick={() => {
                onChange("");
                setText("");
                setOpen(false);
              }}
            >
              All sets
            </button>
          </li>
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={value === s.id ? "active" : ""}
                onClick={() => {
                  onChange(s.id);
                  setText(setLabel(s));
                  setOpen(false);
                }}
              >
                <span className="set-picker-name">{s.name}</span>
                <span className="set-picker-meta">
                  {s.series}
                  {s.releaseDate ? ` · ${s.releaseDate.slice(0, 4)}` : ""}
                </span>
              </button>
            </li>
          ))}
          {!suggestions.length && (
            <li className="set-picker-empty">No sets match “{text.trim()}”</li>
          )}
        </ul>
      )}
    </div>
  );
}

// ---------------- Pocket ----------------
function Pocket({
  slot,
  cols,
  highlightMissing = false,
  selectedForMove = false,
  onDrop,
  onTap,
  onView,
  onRemove,
  onToggleWishlist,
  onToggleOwned,
}: {
  slot: ApiSlot;
  cols: number;
  highlightMissing?: boolean;
  selectedForMove?: boolean;
  onDrop: (e: React.DragEvent, slot: ApiSlot) => void;
  onTap: (slot: ApiSlot) => void;
  onView: (src: string, meta: string) => void;
  onRemove: (slotId: string) => void;
  onToggleWishlist: (slotId: string, onWishlist: boolean) => void;
  onToggleOwned: (slotId: string, owned: boolean) => void;
}) {
  const src = slotImageSrc(slot);
  const filled = !!slot.card;
  const row = Math.floor(slot.slotIndex / cols) + 1;
  const col = (slot.slotIndex % cols) + 1;
  const verification = slot.card?.provenance.verificationStatus ?? null;
  const isNeed = filled && !slot.owned;

  const meta = slot.card
    ? [
        slot.card.name,
        slot.card.setName,
        slot.card.number ? `#${slot.card.number}` : null,
        slot.card.provenance.source
          ? `${slot.card.provenance.source} · ${verification ?? "unverified"}`
          : null,
      ]
        .filter(Boolean)
        .join("  ·  ")
    : "";

  return (
    <div className={`pocket-wrap ${slot.isCenter ? "center" : ""}`}>
      <div className="pocket-role" title={slot.roleLabel}>
        {slot.roleLabel || `R${row}·C${col}`}
      </div>
      <div
        className={[
          "pocket",
          filled ? "filled" : "",
          slot.onWishlist ? "wishlisted" : "",
          slot.owned ? "is-owned" : "",
          isNeed ? "is-need" : "",
          highlightMissing && slot.owned ? "owned-faded" : "",
          highlightMissing && isNeed ? "need-focus" : "",
          selectedForMove ? "move-selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={
          filled
            ? highlightMissing && slot.owned
              ? "Owned — faded while highlighting missing"
              : "Drag or tap to move/swap"
            : undefined
        }
        onDragOver={(e) => {
          allowPocketDrop(e);
          (e.currentTarget as HTMLElement).classList.add("dragover");
        }}
        onDragEnter={(e) => {
          allowPocketDrop(e);
          (e.currentTarget as HTMLElement).classList.add("dragover");
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            (e.currentTarget as HTMLElement).classList.remove("dragover");
          }
        }}
        onDrop={(e) => onDrop(e, slot)}
        draggable={filled}
        onDragStart={(e) => {
          if (!filled) return;
          setDragPayload(e, { type: "slot", slotId: slot.id }, "move");
          (e.currentTarget as HTMLElement).classList.add("dragging");
        }}
        onDragEnd={(e) => {
          (e.currentTarget as HTMLElement).classList.remove("dragging");
          document
            .querySelectorAll(".pocket.dragover")
            .forEach((el) => el.classList.remove("dragover"));
        }}
        onClick={() => onTap(slot)}
      >
        {src ? (
          <>
            {verification && <span className={`prov-dot ${verification}`} title={`Provenance: ${verification}`} />}
            {slot.onWishlist && (
              <span className="wishlist-badge" title="On wishlist">
                ★
              </span>
            )}
            {slot.owned && (
              <span className="owned-badge" title="Owned">
                Own
              </span>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={slot.card?.name ?? "card"} draggable={false} />
            {slot.card?.priceMarket != null && (
              <span className="pocket-price">${slot.card.priceMarket.toFixed(2)}</span>
            )}
            <div
              className="pocket-actions"
              // Keep action clicks from starting a pocket drag.
              onMouseDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
            >
              <button
                className={`pocket-icon-btn ${slot.owned ? "active-owned" : ""}`}
                title={slot.owned ? "Mark as not owned" : "Mark as owned"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleOwned(slot.id, !slot.owned);
                }}
              >
                {slot.owned ? "●" : "○"}
              </button>
              <button
                className={`pocket-icon-btn ${slot.onWishlist ? "active-star" : ""}`}
                title={slot.onWishlist ? "Remove from wishlist" : "Add to wishlist"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleWishlist(slot.id, !slot.onWishlist);
                }}
              >
                {slot.onWishlist ? "★" : "☆"}
              </button>
              <button
                className="pocket-icon-btn"
                title="View full size"
                onClick={(e) => {
                  e.stopPropagation();
                  onView(src, meta);
                }}
              >
                ⤢
              </button>
              <button
                className="pocket-icon-btn"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(slot.id);
                }}
              >
                ✕
              </button>
            </div>
          </>
        ) : (
          <div className="pocket-empty-inner">
            <div className="pocket-plus">+</div>
            <div className="pocket-coord">
              R{row}·C{col}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Result card ----------------
function ResultCard({
  card,
  onClick,
}: {
  card: CardResult;
  onClick: (card: CardResult) => void;
}) {
  const img = card.imageHigh ?? card.imageSmall;
  return (
    <div
      className="result-card"
      draggable
      onDragStart={(e) => setDragPayload(e, { type: "card", card }, "copy")}
      onClick={() => onClick(card)}
      title={`${card.name} — click to place in first empty pocket, or drag onto any pocket`}
    >
      <span className="src-chip">{card.source === "pokemontcg" ? "TCG.io" : "TCGdex"}</span>
      <div className="result-art">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="result-img" src={img} alt={card.name} draggable={false} />
        ) : (
          <div className="result-img placeholder" />
        )}
      </div>
      <div className="result-meta">
        <div className="result-name">{card.name}</div>
        <div className="result-sub">
          <span>
            {[card.setName, card.number ? `#${card.number}` : null].filter(Boolean).join(" · ") ||
              "—"}
          </span>
          {card.rarity && <span>{card.rarity}</span>}
          {card.priceMarket != null && (
            <span className="result-price">${card.priceMarket.toFixed(2)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- New binder modal ----------------
function TransferPageModal({
  pageTitle,
  sourceBinder,
  targets,
  mode,
  targetId,
  busy,
  onMode,
  onTarget,
  onCancel,
  onConfirm,
}: {
  pageTitle: string;
  sourceBinder: ApiBinder;
  targets: ApiBinder[];
  mode: "move" | "copy";
  targetId: string;
  busy: boolean;
  onMode: (m: "move" | "copy") => void;
  onTarget: (id: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const target = targets.find((b) => b.id === targetId) ?? null;
  const gridMismatch =
    !!target &&
    (target.rows !== sourceBinder.rows || target.cols !== sourceBinder.cols);
  const onlyPage = sourceBinder.pages.length <= 1;

  return (
    <div
      className="overlay no-print"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal">
        <h3>Move / Copy Page</h3>
        <p className="modal-lead">
          Send <strong>{pageTitle}</strong> from <strong>{sourceBinder.name}</strong> into
          another binder — cards and wishlist stars come along.
        </p>

        <div className="field">
          <label>Action</label>
          <div className="presets">
            <div
              className={`chip ${mode === "move" ? "selected" : ""} ${onlyPage ? "disabled" : ""}`}
              onClick={() => {
                if (!onlyPage) onMode("move");
              }}
              title={onlyPage ? "Add another page before moving the only page" : undefined}
            >
              Move (remove from here)
            </div>
            <div
              className={`chip ${mode === "copy" ? "selected" : ""}`}
              onClick={() => onMode("copy")}
            >
              Copy (keep original)
            </div>
          </div>
          {onlyPage && mode === "move" && (
            <div className="field-hint">This is the only page — use Copy, or add a page first.</div>
          )}
        </div>

        <div className="field">
          <label>Destination binder</label>
          <select
            className="filter-select"
            value={targetId}
            onChange={(e) => onTarget(e.target.value)}
          >
            {targets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.rows}×{b.cols}, {b.pages.length} page
                {b.pages.length === 1 ? "" : "s"})
              </option>
            ))}
          </select>
        </div>

        {gridMismatch && target && (
          <p className="modal-warn">
            Grid differs ({sourceBinder.rows}×{sourceBinder.cols} → {target.rows}×{target.cols}).
            Cards map by pocket index; extras that don’t fit are skipped.
          </p>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={busy || !targetId || (mode === "move" && onlyPage)}
          >
            {busy ? "Working…" : mode === "move" ? "Move Page" : "Copy Page"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WishlistExportModal({
  form,
  setForm,
  binderName,
  busy,
  onCancel,
  onExport,
}: {
  form: WishlistExportForm;
  setForm: React.Dispatch<React.SetStateAction<WishlistExportForm>>;
  binderName: string | null;
  busy: boolean;
  onCancel: () => void;
  onExport: () => void;
}) {
  return (
    <div
      className="overlay no-print"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal modal-wishlist">
        <h3>Export Wishlist PDF</h3>
        <p className="modal-lead">
          Star pockets with ★, then export a store-ready list. In the print dialog choose{" "}
          <strong>Save as PDF</strong> and email it to the shop.
        </p>

        <div className="field">
          <label>Scope</label>
          <div className="presets">
            <div
              className={`chip ${form.scope === "binder" ? "selected" : ""}`}
              onClick={() => setForm((f) => ({ ...f, scope: "binder" }))}
            >
              This binder{binderName ? `: ${binderName}` : ""}
            </div>
            <div
              className={`chip ${form.scope === "all" ? "selected" : ""}`}
              onClick={() => setForm((f) => ({ ...f, scope: "all" }))}
            >
              All binders
            </div>
          </div>
        </div>

        <div className="field">
          <label>Which cards</label>
          <div className="presets">
            <div
              className={`chip ${form.starredOnly ? "selected" : ""}`}
              onClick={() => setForm((f) => ({ ...f, starredOnly: true }))}
            >
              Starred only
            </div>
            <div
              className={`chip ${!form.starredOnly ? "selected" : ""}`}
              onClick={() => setForm((f) => ({ ...f, starredOnly: false }))}
            >
              Every filled pocket
            </div>
          </div>
        </div>

        <div className="field checklist">
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.includeImages}
              onChange={(e) => setForm((f) => ({ ...f, includeImages: e.target.checked }))}
            />
            Include thumbnail images
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.includePrices}
              onChange={(e) => setForm((f) => ({ ...f, includePrices: e.target.checked }))}
            />
            Include market prices (when known)
          </label>
        </div>

        <div className="field">
          <label>Your name (optional)</label>
          <input
            type="text"
            placeholder="For the store — e.g. Greg"
            value={form.contactName}
            onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
          />
        </div>

        <div className="field">
          <label>Note to store (optional)</label>
          <input
            type="text"
            placeholder="Looking for NM/LP · will trade or buy"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onExport} disabled={busy}>
            {busy ? "Building…" : "Save as PDF…"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WishlistPrintSheet({
  payload,
  onDone,
}: {
  payload: WishlistPrintPayload;
  onDone: () => void;
}) {
  useEffect(() => {
    const finish = () => onDone();
    window.addEventListener("afterprint", finish);
    return () => window.removeEventListener("afterprint", finish);
  }, [onDone]);

  const dateLabel = new Date(payload.generatedAt).toLocaleString();

  return (
    <div className="wishlist-print" aria-label="Wishlist print sheet">
      <header className="wishlist-print-head">
        <div className="wishlist-print-brand">Binder Vault</div>
        <h1>{payload.title}</h1>
        <div className="wishlist-print-meta">
          {payload.contactName && <span>For: {payload.contactName}</span>}
          <span>{payload.items.length} card{payload.items.length === 1 ? "" : "s"}</span>
          <span>{dateLabel}</span>
        </div>
        {payload.note && <p className="wishlist-print-note">{payload.note}</p>}
      </header>

      <table className={`wishlist-table ${payload.includeImages ? "with-thumbs" : "no-thumbs"}`}>
        <thead>
          <tr>
            {payload.includeImages && <th className="col-thumb">Art</th>}
            <th>Card</th>
            <th>Set / #</th>
            <th>Rarity</th>
            {payload.includePrices && <th className="col-price">Market</th>}
            <th>Binder / Page</th>
          </tr>
        </thead>
        <tbody>
          {payload.items.map((item) => {
            const img = payload.includeImages ? wishlistItemImageSrc(item) : null;
            const setNum = [item.setName, item.number ? `#${item.number}` : null]
              .filter(Boolean)
              .join(" · ");
            return (
              <tr key={item.slotId}>
                {payload.includeImages && (
                  <td className="col-thumb">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" />
                    ) : (
                      <span className="thumb-missing">—</span>
                    )}
                  </td>
                )}
                <td className="col-name">
                  <div className="wl-name">{item.name}</div>
                  {item.roleLabel ? <div className="wl-role">{item.roleLabel}</div> : null}
                </td>
                <td>{setNum || "—"}</td>
                <td>{item.rarity || "—"}</td>
                {payload.includePrices && (
                  <td className="col-price">
                    {item.priceMarket != null
                      ? `$${item.priceMarket.toFixed(2)}${
                          item.priceCurrency && item.priceCurrency !== "USD"
                            ? ` ${item.priceCurrency}`
                            : ""
                        }`
                      : "—"}
                  </td>
                )}
                <td className="col-loc">
                  {item.binderName}
                  <br />
                  <span className="wl-page">{item.pageTitle}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <footer className="wishlist-print-foot">
        Generated from Binder Vault · prices are market references, not offers · unverified grades
        never assumed
        <button type="button" className="btn no-print" onClick={onDone}>
          Close preview
        </button>
      </footer>
    </div>
  );
}

function NewBinderModal({
  form,
  setForm,
  onCancel,
  onCreate,
}: {
  form: NewBinderForm;
  setForm: React.Dispatch<React.SetStateAction<NewBinderForm>>;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const activePreset = POCKET_PRESETS.find((p) => p.key === form.presetKey) ?? POCKET_PRESETS[0];
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal">
        <h3>New Binder</h3>

        <div className="field">
          <label>Binder Name</label>
          <input
            type="text"
            placeholder="e.g. Binder 1 — Pokémon History"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>

        <div className="field">
          <label>Spine Color</label>
          <div className="swatches">
            {SPINE_COLORS.map((col) => (
              <div
                key={col}
                className={`swatch ${form.spineColor === col ? "selected" : ""}`}
                style={{ background: col }}
                onClick={() => setForm((f) => ({ ...f, spineColor: col }))}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <label>Layout Style</label>
          <div className="presets">
            <div
              className={`chip ${form.mode === "pocket" ? "selected" : ""}`}
              onClick={() => setForm((f) => ({ ...f, mode: "pocket" }))}
            >
              Pocket Grid
            </div>
            <div
              className={`chip ${form.mode === "era" ? "selected" : ""}`}
              onClick={() => setForm((f) => ({ ...f, mode: "era" }))}
            >
              Themed Era Page
            </div>
          </div>

          {form.mode === "pocket" ? (
            <>
              <div className="presets">
                {POCKET_PRESETS.map((p) => (
                  <div
                    key={p.key}
                    className={`chip ${form.presetKey === p.key ? "selected" : ""}`}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        presetKey: p.key,
                        rows: p.custom ? f.rows : p.rows,
                        cols: p.custom ? f.cols : p.cols,
                      }))
                    }
                  >
                    {p.label}
                  </div>
                ))}
              </div>
              <div className="dims-row">
                <div className="field">
                  <label>Rows</label>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={form.rows}
                    disabled={!activePreset.custom}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, rows: clamp(Number(e.target.value), 1, 8) }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Columns</label>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={form.cols}
                    disabled={!activePreset.custom}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, cols: clamp(Number(e.target.value), 1, 8) }))
                    }
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="section-label">Choose an era template (3×3, center = chase)</div>
              <div className="presets">
                {ERA_TEMPLATES.map((era) => (
                  <div
                    key={era.key}
                    className={`chip ${form.eraKey === era.key ? "selected" : ""}`}
                    onClick={() =>
                      setForm((f) => ({ ...f, eraKey: era.key, spineColor: era.tone }))
                    }
                  >
                    {era.name}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onCreate}>
            Create Binder
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
