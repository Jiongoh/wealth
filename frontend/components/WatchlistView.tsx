"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { BaseModal } from "@/components/BaseModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import {
  api,
  ApiError,
  type DecimalValue,
  type MarketQuote,
  type MarketSubscriptionPlan,
  type SymbolSearchResult,
  type WatchlistItem,
  type WatchlistTag,
} from "@/lib/api";

type SubscriptionSource = "auto" | "manual" | "none";
type ToastTone = "info" | "success" | "error";

// Warn once realtime subscriptions reach this share of the Alpaca free-tier cap.
const SUBSCRIPTION_WARN_RATIO = 0.8;

function SubscriptionUsageBanner({ plan, onManage }: { plan: MarketSubscriptionPlan; onManage: () => void }) {
  const max = Math.max(plan.max_symbols, 1);
  const overCap = plan.overflow_count > 0;
  const nearCap = !overCap && plan.subscribed_count >= max * SUBSCRIPTION_WARN_RATIO;
  const tone = overCap ? "is-over" : nearCap ? "is-near" : "is-ok";
  const manualCount = Math.max(plan.subscribed_count - plan.holdings_count, 0);
  // Two coloured segments inside a pill-shaped clip container; grey track shows behind.
  const totalPct = Math.min((plan.holdings_count + manualCount) / max, 1) * 100;
  const autoPctOfFilled = totalPct > 0 ? Math.min(plan.holdings_count / max, 1) * 100 / totalPct * 100 : 0;
  const manualPctOfFilled = totalPct > 0 ? 100 - autoPctOfFilled : 0;
  return (
    <section className={`subscription-usage ${tone}`} aria-label="Realtime subscription usage">
      <div className="subscription-usage-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="14" cy="16" r="3" fill="currentColor" />
          <path d="M9 11.5a7.07 7.07 0 0 1 10 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          <path d="M5.5 8a12.12 12.12 0 0 1 17 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
      </div>
      <div className="subscription-usage-main">
        <div className="subscription-usage-head">
          <span className="subscription-usage-title">
            Realtime market data · {plan.subscribed_count} / {plan.max_symbols} symbols used
          </span>
        </div>
        <div className="subscription-usage-bar" role="presentation">
          <div className="subscription-usage-filled" style={{ width: `${totalPct}%` }}>
            <span className="subscription-usage-seg subscription-usage-seg-auto" style={{ width: `${autoPctOfFilled}%` }} />
            <span className="subscription-usage-seg subscription-usage-seg-manual" style={{ width: `${manualPctOfFilled}%` }} />
          </div>
        </div>
        <p className="subscription-usage-detail">
          {plan.holdings_count} auto-subscribed from holdings · {manualCount} manually added from watchlist
          {overCap
            ? ` · ${plan.overflow_count} over limit: ${plan.excluded_symbols.join(", ")}`
            : nearCap
              ? " · approaching the free-tier limit"
              : ""}
        </p>
      </div>
      <button className="secondary-button subscription-usage-manage" onClick={onManage} type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Manage subscription
      </button>
    </section>
  );
}

function SubscriptionBadge({ source }: { source: SubscriptionSource }) {
  if (source === "auto") {
    return (
      <span className="sub-badge sub-badge-auto" title="Auto-subscribed because you hold this position">
        RT
      </span>
    );
  }
  if (source === "manual") {
    return (
      <span className="sub-badge sub-badge-manual" title="Manually subscribed to realtime data">
        subscribed
      </span>
    );
  }
  return null;
}

const MAX_TAGS_PER_TICKER = 5;
const MAX_TAGS_PER_REQUEST = 5;
const MAX_SELECTED_FILTER_TAGS = 5;
const TAG_FILTER_COLLAPSED_COUNT = 6;
// Tracked-ticker cards lazy-load in batches as the page scrolls (no pager).
const WATCHLIST_PAGE_SIZE = 24;
// Existing-tickers list lazy-loads in batches as the modal scrolls (no nested scrollbar).
const TICKER_PAGE_INCREMENT = 12;
const DEFAULT_TAG_COLOR = "#F7DFA6";
const EMPTY_TICKER_FORM: TickerForm = { symbol: "", displayName: "", selectedTags: [], newTag: "", notes: "" };

type WatchlistRow = WatchlistItem & {
  status: string;
  actions: string;
  tagList: string;
};

type TickerForm = {
  symbol: string;
  displayName: string;
  selectedTags: string[];
  newTag: string;
  notes: string;
};

type EditForm = {
  symbol: string;
  selectedTags: string[];
  tagInput: string;
  notes: string;
};


function decimalNumber(value: DecimalValue): number | null {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value: DecimalValue, maximumFractionDigits = 2): string {
  const number = decimalNumber(value);
  return number === null
    ? "--"
    : number.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits,
      });
}

function formatCloseDate(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function parseTags(value: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  value.split(",").forEach((rawTag) => {
    const tag = rawTag.trim();
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) {
      return;
    }
    seen.add(key);
    tags.push(tag);
  });

  return tags;
}

function addUniqueTags(current: string[], additions: string[]): string[] {
  const next = [...current];
  const seen = new Set(current.map((tag) => tag.toLocaleLowerCase()));

  additions.forEach((tag) => {
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      next.push(tag);
    }
  });

  return next;
}

function tagColor(tag: string, tags: WatchlistTag[]): string {
  return tags.find((item) => item.name.toLocaleLowerCase() === tag.toLocaleLowerCase())?.color ?? DEFAULT_TAG_COLOR;
}

export function WatchlistView() {
  const [items, setItems] = useState<WatchlistItem[] | null>(null);
  const [tags, setTags] = useState<WatchlistTag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [holdingOnly, setHoldingOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(WATCHLIST_PAGE_SIZE);
  const watchlistSentinelRef = useRef<HTMLDivElement | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<"tickers" | "tags">("tickers");
  const [tickerRenderLimit, setTickerRenderLimit] = useState(TICKER_PAGE_INCREMENT);
  const tickerSentinelRef = useRef<HTMLDivElement | null>(null);
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [form, setForm] = useState<TickerForm>(EMPTY_TICKER_FORM);
  const [tagForm, setTagForm] = useState("");
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  // Tag actions menu: fixed-positioned so it escapes the modal's scroll clip.
  const [tagMenu, setTagMenu] = useState<{ id: number; left: number; top: number } | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ symbol: "", selectedTags: [], tagInput: "", notes: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [filterNotice, setFilterNotice] = useState<string | null>(null);
  const [symbolResults, setSymbolResults] = useState<SymbolSearchResult[]>([]);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [isSymbolSearching, setIsSymbolSearching] = useState(false);
  const [symbolSearchError, setSymbolSearchError] = useState<string | null>(null);
  const [subscriptionPlan, setSubscriptionPlan] = useState<MarketSubscriptionPlan | null>(null);
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
  // Company name + exchange per symbol, lazily fetched from the Nasdaq Symbol
  // Directory (GET /symbols/{symbol}) as cards become visible and cached here.
  // A value of null means "looked up, not in the directory".
  const [symbolMeta, setSymbolMeta] = useState<Record<string, { name: string | null; exchange: string | null } | null>>({});
  const symbolMetaRequestedRef = useRef<Set<string>>(new Set());
  const [tagFilterExpanded, setTagFilterExpanded] = useState(false);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [manageSubscriptionOpen, setManageSubscriptionOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  // Themed tag-dot tooltip. Rendered fixed at the page level (with viewport
  // coordinates captured on hover) so it escapes the watchlist panel's
  // overflow:hidden clip instead of using an absolutely-positioned child.
  const [tagTip, setTagTip] = useState<{ text: string; left: number; top: number } | null>(null);

  async function loadWatchlist() {
    setIsLoading(true);
    setError(null);
    try {
      const [nextItems, nextTags] = await Promise.all([api.watchlist(), api.watchlistTags()]);
      setItems(nextItems);
      setTags(nextTags);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadWatchlist();
    // Initial load only; filter changes are handled explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSubscriptionData() {
    // Subscription usage + quotes are best-effort: a failure here must not
    // block the watchlist itself, so they load separately and degrade silently.
    try {
      const [plan, quoteRows] = await Promise.all([api.marketSubscriptionPlan(), api.marketQuotes()]);
      setSubscriptionPlan(plan);
      const map: Record<string, MarketQuote> = {};
      for (const quote of quoteRows) {
        map[quote.symbol.toUpperCase()] = quote;
      }
      setQuotes(map);
    } catch {
      setSubscriptionPlan(null);
      setQuotes({});
    }
  }

  useEffect(() => {
    loadSubscriptionData();
    // Keep subscribed prices and the change % fresh, like the details page.
    const intervalId = window.setInterval(loadSubscriptionData, 15_000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setVisibleCount(WATCHLIST_PAGE_SIZE);
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    if (!filterNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setFilterNotice(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [filterNotice]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  // Close the custom-tag action menu on outside click or any scroll (the menu
  // is fixed-positioned, so scrolling would otherwise detach it from the pill).
  useEffect(() => {
    if (tagMenu === null) {
      return;
    }
    function handlePointerDown(event: globalThis.MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target || (!target.closest(".tag-manage-pill-wrap") && !target.closest(".tag-menu-popover"))) {
        setTagMenu(null);
      }
    }
    function handleScroll() {
      setTagMenu(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [tagMenu]);

  // Block navigation to the details page for symbols without realtime data; a
  // toast explains they must subscribe first.
  function guardDetailsNavigation(item: WatchlistItem, event: { preventDefault: () => void }) {
    if (isSubscribed(item)) {
      return;
    }
    event.preventDefault();
    setToast({ message: `Subscribe to market data for ${item.symbol} first to view its details.`, tone: "info" });
  }

  // Reset the lazy-load window whenever the modal opens or the Tickers tab is shown.
  useEffect(() => {
    if (manageOpen && manageTab === "tickers") {
      setTickerRenderLimit(TICKER_PAGE_INCREMENT);
    }
  }, [manageOpen, manageTab]);

  // Grow the rendered window as the sentinel scrolls into view (infinite scroll).
  useEffect(() => {
    if (!manageOpen || manageTab !== "tickers") {
      return;
    }
    const sentinel = tickerSentinelRef.current;
    if (!sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setTickerRenderLimit((current) => current + TICKER_PAGE_INCREMENT);
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [manageOpen, manageTab, tickerRenderLimit, items]);

  useEffect(() => {
    if (!manageOpen || manageTab !== "tickers") {
      setSymbolResults([]);
      setSymbolSearchOpen(false);
      setIsSymbolSearching(false);
      setSymbolSearchError(null);
      return;
    }

    const query = form.symbol.trim();
    if (!query) {
      setSymbolResults([]);
      setSymbolSearchOpen(false);
      setIsSymbolSearching(false);
      setSymbolSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setIsSymbolSearching(true);
      setSymbolSearchError(null);
      api
        .searchSymbols({ q: query, limit: 20 }, { signal: controller.signal })
        .then((results) => {
          setSymbolResults(results);
          setSymbolSearchOpen(true);
        })
        .catch((requestError: unknown) => {
          if (requestError instanceof DOMException && requestError.name === "AbortError") {
            return;
          }
          setSymbolResults([]);
          setSymbolSearchOpen(true);
          setSymbolSearchError(requestError instanceof Error ? requestError.message : "Symbol search failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsSymbolSearching(false);
          }
        });
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [form.symbol, manageOpen, manageTab]);

  async function addTicker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = form.symbol.trim().toUpperCase();
    const parsedTags = addUniqueTags(form.selectedTags, parseTags(form.newTag));
    if (!symbol) {
      setDialogError("Symbol is required.");
      return;
    }
    if (parsedTags.length > MAX_TAGS_PER_TICKER) {
      setDialogError(`Each ticker can have at most ${MAX_TAGS_PER_TICKER} tags.`);
      return;
    }
    // Symbols are unique in the watchlist. Block a duplicate add up front (the
    // backend also rejects with 409) so we never overwrite an existing entry.
    if ((items ?? []).some((entry) => entry.symbol.toUpperCase() === symbol)) {
      setDialogError(`${symbol} is already in your watchlist.`);
      setToast({ message: `${symbol} is already in your watchlist.`, tone: "error" });
      return;
    }
    setIsSaving(true);
    setDialogError(null);
    try {
      // Only allow symbols that exist in the Nasdaq Symbol Directory; reject
      // anything else before creating a watchlist record. Modal stays open.
      try {
        await api.symbolInfo(symbol);
      } catch (lookupError: unknown) {
        if (lookupError instanceof ApiError && lookupError.status === 404) {
          setDialogError(`${symbol} was not found in the symbol directory.`);
          setToast({ message: `Couldn't add ${symbol}: not a recognised symbol.`, tone: "error" });
        } else {
          setDialogError(lookupError instanceof Error ? lookupError.message : "Symbol lookup failed.");
          setToast({ message: `Couldn't add ${symbol}. Please try again.`, tone: "error" });
        }
        return;
      }

      await api.createWatchlistTicker({
        symbol,
        tags: parsedTags,
        display_name: form.displayName.trim() || null,
        notes: form.notes.trim() || null,
      });
      resetTickerForm();
      setVisibleCount(WATCHLIST_PAGE_SIZE);
      await loadWatchlist();
      setManageOpen(false);
      setToast({ message: `Added ${symbol} to your watchlist.`, tone: "success" });
    } catch (requestError: unknown) {
      if (requestError instanceof ApiError && requestError.status === 409) {
        setDialogError(`${symbol} is already in your watchlist.`);
        setToast({ message: `${symbol} is already in your watchlist.`, tone: "error" });
      } else {
        setDialogError(requestError instanceof Error ? requestError.message : "Request failed.");
        setToast({ message: `Couldn't add ${symbol}. Please try again.`, tone: "error" });
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function addTags(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedTags = parseTags(tagForm);
    if (parsedTags.length === 0) {
      setDialogError("Enter at least one tag.");
      return;
    }
    if (parsedTags.length > MAX_TAGS_PER_REQUEST) {
      setDialogError(`You can add at most ${MAX_TAGS_PER_REQUEST} tags at once.`);
      return;
    }
    setIsSaving(true);
    setDialogError(null);
    try {
      const nextTags = await api.createWatchlistTags(parsedTags);
      setTags(nextTags);
      setTagForm("");
      await loadWatchlist();
      setSelectedTags([]);
      setHoldingOnly(false);
      setVisibleCount(WATCHLIST_PAGE_SIZE);
    } catch (requestError: unknown) {
      setDialogError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setIsSaving(false);
    }
  }

  function startTagEdit(tag: WatchlistTag) {
    setEditingTagId(tag.id);
    setEditingTagName(tag.name);
    setTagMenu(null);
    setDialogError(null);
  }

  function toggleTagMenu(tagId: number, event: { currentTarget: HTMLElement }) {
    setDialogError(null);
    // Read the trigger's rect synchronously: React nulls event.currentTarget
    // once the handler returns, so it must not be touched inside the (deferred)
    // state updater below.
    const rect = event.currentTarget.getBoundingClientRect();
    // Keep the menu (min-width ~140px) within the viewport for right-edge pills.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 152));
    setTagMenu((current) =>
      current?.id === tagId ? null : { id: tagId, left, top: rect.bottom + 6 },
    );
  }

  async function saveTagEdit(tagId: number) {
    const name = editingTagName.trim();
    if (!name) {
      setDialogError("Tag name is required.");
      return;
    }
    setIsSaving(true);
    setDialogError(null);
    try {
      await api.updateWatchlistTag(tagId, { name });
      setEditingTagId(null);
      setEditingTagName("");
      setSelectedTags([]);
      setHoldingOnly(false);
      setVisibleCount(WATCHLIST_PAGE_SIZE);
      await loadWatchlist();
    } catch (requestError: unknown) {
      setDialogError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteGlobalTag(tag: WatchlistTag) {
    const confirmed = window.confirm(
      `Delete tag "${tag.name}"? This will remove it from all tickers, but will not delete any ticker.`,
    );
    if (!confirmed) {
      return;
    }
    setIsSaving(true);
    setDialogError(null);
    try {
      await api.deleteWatchlistTag(tag.id);
      setEditingTagId(null);
      setEditingTagName("");
      setSelectedTags([]);
      setHoldingOnly(false);
      setVisibleCount(WATCHLIST_PAGE_SIZE);
      await loadWatchlist();
      setEditForm((current) => ({
        ...current,
        selectedTags: current.selectedTags.filter(
          (selectedTag) => selectedTag.toLocaleLowerCase() !== tag.name.toLocaleLowerCase(),
        ),
      }));
    } catch (requestError: unknown) {
      setDialogError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setIsSaving(false);
    }
  }

  function startEdit(row: WatchlistItem) {
    setEditingSymbol(row.symbol);
    setDialogError(null);
    setEditForm({
      symbol: row.symbol,
      selectedTags: row.tags,
      tagInput: "",
      notes: row.notes ?? "",
    });
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSymbol) {
      return;
    }
    const nextTags = addUniqueTags(editForm.selectedTags, parseTags(editForm.tagInput));
    if (nextTags.length > MAX_TAGS_PER_TICKER) {
      setDialogError(`Each ticker can have at most ${MAX_TAGS_PER_TICKER} tags.`);
      return;
    }
    setIsSaving(true);
    setDialogError(null);
    try {
      await api.updateWatchlistTicker(editingSymbol, {
        tags: nextTags,
        notes: editForm.notes.trim() || null,
      });
      setEditingSymbol(null);
      setVisibleCount(WATCHLIST_PAGE_SIZE);
      await loadWatchlist();
    } catch (requestError: unknown) {
      setDialogError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setIsSaving(false);
    }
  }

  function addEditInputTags() {
    const nextTags = addUniqueTags(editForm.selectedTags, parseTags(editForm.tagInput));
    if (nextTags.length > MAX_TAGS_PER_TICKER) {
      setDialogError(`Each ticker can have at most ${MAX_TAGS_PER_TICKER} tags.`);
      return;
    }
    setDialogError(null);
    setEditForm((current) => ({ ...current, selectedTags: nextTags, tagInput: "" }));
  }

  function removeEditTag(tagToRemove: string) {
    setEditForm((current) => ({
      ...current,
      selectedTags: current.selectedTags.filter((tag) => tag.toLocaleLowerCase() !== tagToRemove.toLocaleLowerCase()),
    }));
  }

  async function deleteTicker(symbol: string) {
    const confirmed = window.confirm(
      `Delete ticker "${symbol}" from your watchlist? This will not delete any IBKR position, lot, trade, or cash data.`,
    );
    if (!confirmed) {
      return;
    }
    setIsSaving(true);
    setError(null);
    setDialogError(null);
    try {
      await api.deleteWatchlistTicker(symbol);
      if (editingSymbol === symbol) {
        setEditingSymbol(null);
      }
      setVisibleCount(WATCHLIST_PAGE_SIZE);
      await loadWatchlist();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleSubscription(item: WatchlistItem) {
    if (item.has_position) {
      // Holdings auto-subscribe and are locked; nothing to toggle.
      return;
    }
    const next = !item.realtime_enabled;
    setIsSaving(true);
    setError(null);
    try {
      await api.updateWatchlistTicker(item.symbol, { realtime_enabled: next });
      await Promise.all([loadWatchlist(), loadSubscriptionData()]);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setIsSaving(false);
    }
  }

  function clearSelectedTags() {
    setSelectedTags([]);
    setHoldingOnly(false);
    setFilterNotice(null);
    setVisibleCount(WATCHLIST_PAGE_SIZE);
  }

  function toggleHoldingFilter() {
    setHoldingOnly((current) => !current);
    setFilterNotice(null);
    setVisibleCount(WATCHLIST_PAGE_SIZE);
  }

  function toggleFilterTag(tag: string) {
    const tagKey = tag.toLocaleLowerCase();
    setSelectedTags((current) => {
      const exists = current.some((selectedTag) => selectedTag.toLocaleLowerCase() === tagKey);
      if (exists) {
        setFilterNotice(null);
        return current.filter((selectedTag) => selectedTag.toLocaleLowerCase() !== tagKey);
      }
      if (current.length >= MAX_SELECTED_FILTER_TAGS) {
        setFilterNotice(`You can select up to ${MAX_SELECTED_FILTER_TAGS} tags.`);
        return current;
      }
      setFilterNotice(null);
      return [...current, tag];
    });
    setVisibleCount(WATCHLIST_PAGE_SIZE);
  }

  function selectSymbolResult(result: SymbolSearchResult) {
    setForm((current) => ({
      ...current,
      symbol: result.symbol.toUpperCase(),
      // Autofill the company name from search; keep any name the user already typed.
      displayName: current.displayName.trim() || (result.name ?? ""),
    }));
    setSymbolResults([]);
    setSymbolSearchOpen(false);
    setSymbolSearchError(null);
  }

  function toggleAddFormTag(tagName: string) {
    setForm((current) => {
      const exists = current.selectedTags.some((tag) => tag.toLocaleLowerCase() === tagName.toLocaleLowerCase());
      if (exists) {
        return {
          ...current,
          selectedTags: current.selectedTags.filter((tag) => tag.toLocaleLowerCase() !== tagName.toLocaleLowerCase()),
        };
      }
      if (current.selectedTags.length >= MAX_TAGS_PER_TICKER) {
        setDialogError(`Each ticker can have at most ${MAX_TAGS_PER_TICKER} tags.`);
        return current;
      }
      setDialogError(null);
      return { ...current, selectedTags: [...current.selectedTags, tagName] };
    });
  }

  function addNewFormTag() {
    const next = addUniqueTags(form.selectedTags, parseTags(form.newTag));
    if (next.length > MAX_TAGS_PER_TICKER) {
      setDialogError(`Each ticker can have at most ${MAX_TAGS_PER_TICKER} tags.`);
      return;
    }
    setDialogError(null);
    setForm((current) => ({ ...current, selectedTags: next, newTag: "" }));
  }

  function resetTickerForm() {
    setForm(EMPTY_TICKER_FORM);
    setNewTagOpen(false);
    setSymbolResults([]);
    setSymbolSearchOpen(false);
    setIsSymbolSearching(false);
    setSymbolSearchError(null);
  }

  function openManage(tab: "tickers" | "tags") {
    setDialogError(null);
    setEditingTagId(null);
    setEditingTagName("");
    setManageTab(tab);
    setManageOpen(true);
  }

  function closeManage() {
    setManageOpen(false);
    setDialogError(null);
    setEditingTagId(null);
    setEditingTagName("");
    setTagMenu(null);
    resetTickerForm();
  }

  function startManagedTickerEdit(row: WatchlistItem) {
    setManageOpen(false);
    startEdit(row);
  }

  const rows: WatchlistRow[] = useMemo(() => {
    const selectedTagKeys = selectedTags.map((tag) => tag.toLocaleLowerCase());
    const searchTerm = debouncedSearch.toLocaleLowerCase();

    return (items ?? [])
      .filter((item) => {
        const matchesHolding = !holdingOnly || item.has_position;
        const itemTagKeys = item.tags.map((tag) => tag.toLocaleLowerCase());
        const matchesTags =
          selectedTagKeys.length === 0 || selectedTagKeys.every((tag) => itemTagKeys.includes(tag));
        const matchesSearch = !searchTerm || item.symbol.toLocaleLowerCase().includes(searchTerm);

        return matchesHolding && matchesTags && matchesSearch;
      })
      // Holdings first, then manually-subscribed, then unsubscribed; symbol A→Z within each group.
      .sort((a, b) => {
        const rank = (item: WatchlistItem) => (item.has_position ? 0 : item.realtime_enabled ? 1 : 2);
        return rank(a) - rank(b) || a.symbol.localeCompare(b.symbol);
      })
      .map((item) => ({
        ...item,
        status: item.has_position ? "Holding" : "No Position",
        actions: item.symbol,
        tagList: item.tags.join(", "),
      }));
  }, [debouncedSearch, holdingOnly, items, selectedTags]);

  const visibleRows = rows.slice(0, visibleCount);
  const hasMoreRows = visibleCount < rows.length;
  const holdingCount = items?.filter((item) => item.has_position).length ?? 0;

  // Grow the rendered card window as the sentinel scrolls into view. Declared
  // after `rows` so its dependency on rows.length is in scope.
  useEffect(() => {
    const sentinel = watchlistSentinelRef.current;
    if (!sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((current) => current + WATCHLIST_PAGE_SIZE);
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, rows.length]);

  // Lazily fetch company name + exchange for the symbols currently rendered,
  // deduped via a ref so each symbol is requested at most once per session.
  const visibleSymbolsKey = visibleRows.map((row) => row.symbol.toUpperCase()).join(",");
  useEffect(() => {
    const pending = Array.from(new Set(visibleSymbolsKey.split(",").filter(Boolean))).filter(
      (symbol) => !symbolMetaRequestedRef.current.has(symbol),
    );
    if (pending.length === 0) {
      return;
    }
    let active = true;
    pending.forEach((symbol) => symbolMetaRequestedRef.current.add(symbol));
    void Promise.all(
      pending.map(async (symbol) => {
        try {
          const info = await api.symbolInfo(symbol);
          return [symbol, { name: info.name, exchange: info.exchange }] as const;
        } catch {
          // 404 (not in directory) or network error: cache null so we don't retry.
          return [symbol, null] as const;
        }
      }),
    ).then((entries) => {
      if (active) {
        setSymbolMeta((current) => ({ ...current, ...Object.fromEntries(entries) }));
      }
    });
    return () => {
      active = false;
    };
  }, [visibleSymbolsKey]);

  const allFiltersCleared = selectedTags.length === 0 && !holdingOnly;

  const subscribedSet = useMemo(
    () => new Set((subscriptionPlan?.symbols ?? []).map((symbol) => symbol.toUpperCase())),
    [subscriptionPlan],
  );
  const capReached = subscriptionPlan ? subscriptionPlan.subscribed_count >= subscriptionPlan.max_symbols : false;

  function subscriptionSource(item: WatchlistItem): SubscriptionSource {
    if (item.has_position) {
      return "auto";
    }
    if (item.realtime_enabled) {
      return "manual";
    }
    return "none";
  }

  function isSubscribed(item: WatchlistItem): boolean {
    return item.has_position || subscribedSet.has(item.symbol.toUpperCase());
  }

  // Whether the symbol is actually receiving realtime market data right now (in
  // the worker's subscription plan). Held positions over the cap or off-hours
  // are NOT streaming and fall back to the IBKR flex close below.
  function isStreaming(item: WatchlistItem): boolean {
    return subscribedSet.has(item.symbol.toUpperCase());
  }

  // Realtime last price when streaming; otherwise the IBKR flex-query close
  // (held positions only). Non-held, non-streaming symbols have neither → "--".
  function priceFor(item: WatchlistItem): DecimalValue {
    const quote = quotes[item.symbol.toUpperCase()];
    if (isStreaming(item) && quote && decimalNumber(quote.last_price ?? null) !== null) {
      return quote.last_price;
    }
    return item.current_price;
  }

  // Daily change only for streaming symbols: realtime price vs the previous
  // session close (Alpaca prevDailyBar / Yahoo previousClose). The IBKR close
  // is a prior-day snapshot, so non-streaming cards show no change badge.
  function changePctFor(item: WatchlistItem): number | null {
    if (!isStreaming(item)) {
      return null;
    }
    const quote = quotes[item.symbol.toUpperCase()];
    const last = decimalNumber(quote?.last_price ?? null);
    const reference = decimalNumber(quote?.previous_close ?? null);
    if (last === null || reference === null || reference === 0) {
      return null;
    }
    return ((last - reference) / reference) * 100;
  }

  // True when the displayed price is the IBKR flex close rather than a realtime
  // quote (held position not streaming, or streaming with no tick yet).
  function priceIsIbkrClose(item: WatchlistItem): boolean {
    const quote = quotes[item.symbol.toUpperCase()];
    if (isStreaming(item) && decimalNumber(quote?.last_price ?? null) !== null) {
      return false;
    }
    return decimalNumber(item.current_price) !== null;
  }

  // Every symbol already in the watchlist; used to block duplicate adds and to
  // mark already-added rows in the symbol search dropdown.
  const watchlistSymbolSet = useMemo(
    () => new Set((items ?? []).map((item) => item.symbol.toUpperCase())),
    [items],
  );

  const manualSymbolSet = useMemo(
    () =>
      new Set(
        (items ?? [])
          .filter((item) => item.realtime_enabled && !item.has_position)
          .map((item) => item.symbol.toUpperCase()),
      ),
    [items],
  );
  // Green: actually-streaming symbols that aren't manual = holdings (locked).
  const poolAuto = useMemo(
    () => Array.from(subscribedSet).filter((symbol) => !manualSymbolSet.has(symbol)).sort(),
    [subscribedSet, manualSymbolSet],
  );
  const poolManual = useMemo(
    () =>
      (items ?? [])
        .filter((item) => item.realtime_enabled && !item.has_position)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [items],
  );
  const poolNone = useMemo(
    () =>
      (items ?? [])
        .filter((item) => !item.has_position && !item.realtime_enabled)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [items],
  );

  return (
    <>
      {toast ? (
        <div className={`watchlist-toast watchlist-toast-${toast.tone}`} role="status" aria-live="polite">
          <span className="watchlist-toast-icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              {toast.tone === "success" ? (
                <>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8.5 12.5l2.5 2.5 4.5-5" />
                </>
              ) : toast.tone === "error" ? (
                <>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M15 9l-6 6" />
                  <path d="M9 9l6 6" />
                </>
              ) : (
                <>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5" />
                  <path d="M12 16.5h.01" />
                </>
              )}
            </svg>
          </span>
          {toast.message}
        </div>
      ) : null}
      {tagTip ? (
        <div className="ticker-tag-tip" role="tooltip" style={{ left: tagTip.left, top: tagTip.top }}>
          {tagTip.text}
        </div>
      ) : null}
      <div className="page-header">
        <div>
          <p className="eyebrow">Personal research</p>
          <h1>Watchlist</h1>
          <p className="page-description">Track the tickers you care about, with custom tags and portfolio links.</p>
        </div>
        <div className="watchlist-header-actions">
          <button className="secondary-button" onClick={() => openManage("tickers")} type="button">
            Manage
          </button>
        </div>
      </div>

      {subscriptionPlan ? (
        <SubscriptionUsageBanner plan={subscriptionPlan} onManage={() => setManageSubscriptionOpen(true)} />
      ) : null}

      <section className="panel watchlist-panel">
        <div className="panel-header positions-panel-header">
          <div>
            <h2>Tracked Tickers</h2>
            <p>
              {holdingOnly || selectedTags.length > 0
                ? `Filtered by ${[holdingOnly ? "Holding" : null, ...selectedTags].filter(Boolean).join(" + ")}.`
                : "All tickers in your personal watchlist."}
            </p>
          </div>
          <div className="table-controls positions-table-controls">
            <label className="search-field positions-search-field">
              <span className="sr-only">Search watchlist by symbol</span>
              <span className="positions-search-shell">
                <input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search symbol"
                  type="search"
                  value={search}
                />
              </span>
            </label>
          </div>
        </div>
        <div className="tag-filter" aria-label="Watchlist tag filter">
          <div className="tag-filter-system" role="group" aria-label="System filters">
            <button
              aria-pressed={allFiltersCleared}
              className={`tag-filter-button tag-filter-system-button${allFiltersCleared ? " tag-filter-button-active" : ""}`}
              onClick={clearSelectedTags}
              type="button"
            >
              All
            </button>
            <button
              aria-pressed={holdingOnly}
              className={`tag-filter-button tag-filter-system-button holding-filter-button${holdingOnly ? " tag-filter-button-active holding-filter-button-active" : ""}`}
              onClick={toggleHoldingFilter}
              type="button"
            >
              <span className="holding-filter-dot" />
              {holdingOnly ? <span className="tag-filter-check">✓</span> : null}
              Holding <span>{holdingCount}</span>
            </button>
          </div>
          {tags.length > 0 ? <span className="tag-filter-divider" aria-hidden="true" /> : null}
          {(tagFilterExpanded ? tags : tags.slice(0, TAG_FILTER_COLLAPSED_COUNT)).map((tag) => {
            const selected = selectedTags.some(
              (selectedTag) => selectedTag.toLocaleLowerCase() === tag.name.toLocaleLowerCase(),
            );

            return (
              <button
                aria-pressed={selected}
                className={`tag-filter-button${selected ? " tag-filter-button-active" : ""}`}
                key={tag.name}
                onClick={() => toggleFilterTag(tag.name)}
                style={{ backgroundColor: selected ? tag.color ?? DEFAULT_TAG_COLOR : undefined }}
                type="button"
              >
                <span className="tag-filter-dot" style={{ backgroundColor: tag.color ?? DEFAULT_TAG_COLOR }} />
                {selected ? <span className="tag-filter-check">✓</span> : null}
                {tag.name} <span>{tag.count}</span>
              </button>
            );
          })}
          {tags.length > TAG_FILTER_COLLAPSED_COUNT ? (
            <button
              className="tag-filter-button tag-filter-more"
              onClick={() => setTagFilterExpanded((value) => !value)}
              type="button"
            >
              {tagFilterExpanded ? "Show less" : `+${tags.length - TAG_FILTER_COLLAPSED_COUNT} more`}
            </button>
          ) : null}
        </div>
        {filterNotice ? <p className="filter-notice">{filterNotice}</p> : null}
        {error ? <ErrorState message={error} title="Watchlist request failed" /> : null}
        {isLoading ? (
          <div className="panel-state">
            <LoadingState message="Loading watchlist..." />
          </div>
        ) : items && items.length === 0 ? (
          <div className="panel-state">
            <EmptyState message="Add a ticker to start building your personal watchlist." title="Nothing tracked yet" />
          </div>
        ) : (
          <>
            {rows.length === 0 ? (
              <div className="panel-state">
                <EmptyState message="No tickers match the selected filter." title="No matches" />
              </div>
            ) : (
              <div className="ticker-card-grid">
                {visibleRows.map((row) => {
                  const price = priceFor(row);
                  const change = changePctFor(row);
                  const isCloseFallback = priceIsIbkrClose(row);
                  const meta = symbolMeta[row.symbol.toUpperCase()];
                  const companyName = meta?.name ?? row.display_name ?? null;
                  const exchange = meta?.exchange ?? null;
                  return (
                    <Link
                      className="ticker-card"
                      href={`/details/${encodeURIComponent(row.symbol.toUpperCase())}?from=watchlist`}
                      key={row.id}
                      onClick={(event) => guardDetailsNavigation(row, event)}
                    >
                      <div className="ticker-card-head">
                        <div className="ticker-card-id">
                          <strong className="ticker-card-symbol">{row.symbol}</strong>
                          {companyName ? (
                            <span className="ticker-card-company">{companyName}</span>
                          ) : null}
                          {exchange ? (
                            <span className="ticker-card-exchange">{exchange}</span>
                          ) : null}
                        </div>
                        <SubscriptionBadge source={subscriptionSource(row)} />
                      </div>
                      <div className="ticker-card-dots" aria-label="Tags">
                        {row.tags.length > 0 ? (
                          row.tags.map((tag) => (
                            <span
                              className="ticker-card-dot"
                              key={tag}
                              aria-label={tag}
                              style={{ backgroundColor: tagColor(tag, tags) }}
                              onMouseEnter={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                setTagTip({ text: tag, left: rect.left + rect.width / 2, top: rect.top });
                              }}
                              onMouseLeave={() => setTagTip(null)}
                            />
                          ))
                        ) : (
                          <span className="ticker-card-dots-empty">No tags</span>
                        )}
                      </div>
                      <div className="ticker-card-foot">
                        <span className="ticker-card-price-wrap">
                          {price === null ? (
                            <span className="ticker-card-price is-muted">--</span>
                          ) : (
                            <span className="ticker-card-price">{`$${formatNumber(price)}`}</span>
                          )}
                          {isCloseFallback && row.latest_report_date ? (
                            <span className="ticker-card-close-note">{`${formatCloseDate(row.latest_report_date)} close`}</span>
                          ) : null}
                        </span>
                        {change !== null ? (
                          <span
                            className={`ticker-card-change ${change > 0 ? "is-up" : change < 0 ? "is-down" : "is-flat"}`}
                          >
                            {`${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
            {hasMoreRows ? (
              <div className="ticker-card-sentinel" ref={watchlistSentinelRef} aria-hidden="true" />
            ) : null}
          </>
        )}
      </section>

      <BaseModal
        className="manage-subscription-modal"
        description={
          subscriptionPlan
            ? `${subscriptionPlan.subscribed_count} / ${subscriptionPlan.max_symbols} symbols used. Holdings subscribe automatically and are locked.`
            : "Holdings subscribe automatically and are locked."
        }
        isOpen={manageSubscriptionOpen}
        onClose={() => setManageSubscriptionOpen(false)}
        title="Subscription pool"
      >
        <div className="subscription-pool-chips">
          {poolAuto.length === 0 && poolManual.length === 0 && poolNone.length === 0 ? (
            <span className="watchlist-muted">No symbols yet.</span>
          ) : null}
          {poolAuto.map((symbol) => (
            <span className="sub-chip sub-chip-auto" key={`auto-${symbol}`} title="Holding · auto-subscribed (locked)">
              {symbol}
              <span className="sub-chip-icon" aria-hidden="true">🔒</span>
            </span>
          ))}
          {poolManual.map((item) => (
            <button
              className="sub-chip sub-chip-manual"
              disabled={isSaving}
              key={`manual-${item.symbol}`}
              onClick={() => toggleSubscription(item)}
              title="Manually subscribed · click to unsubscribe"
              type="button"
            >
              {item.symbol}
              <span className="sub-chip-icon" aria-hidden="true">×</span>
            </button>
          ))}
          {poolNone.map((item) => (
            <button
              className="sub-chip sub-chip-none"
              disabled={isSaving || capReached}
              key={`none-${item.symbol}`}
              onClick={() => toggleSubscription(item)}
              title={capReached ? "Subscription limit reached" : "Delayed only · click to subscribe"}
              type="button"
            >
              {item.symbol}
              <span className="sub-chip-icon" aria-hidden="true">+</span>
            </button>
          ))}
        </div>
        <div className="subscription-pool-legend">
          <span>
            <span className="legend-dot legend-dot-auto" /> Holding (auto, locked)
          </span>
          <span>
            <span className="legend-dot legend-dot-manual" /> Manual subscription
          </span>
          <span>
            <span className="legend-dot legend-dot-none" /> Delayed only
          </span>
        </div>
      </BaseModal>

      <BaseModal
        className="manage-watchlist-modal"
        description="Add tickers and organise them with custom tags — all in one place."
        isOpen={manageOpen}
        onClose={closeManage}
        title="Manage watchlist"
      >
        <div className="manage-tabs" role="tablist">
          <button
            aria-selected={manageTab === "tickers"}
            className={`manage-tab${manageTab === "tickers" ? " is-active" : ""}`}
            onClick={() => setManageTab("tickers")}
            role="tab"
            type="button"
          >
            <span className="manage-tab-icon" aria-hidden="true">☰</span>
            Tickers
            <span className="manage-tab-count">{items?.length ?? 0}</span>
          </button>
          <button
            aria-selected={manageTab === "tags"}
            className={`manage-tab${manageTab === "tags" ? " is-active" : ""}`}
            onClick={() => setManageTab("tags")}
            role="tab"
            type="button"
          >
            <span className="manage-tab-icon" aria-hidden="true">🏷</span>
            Tags
            <span className="manage-tab-count">{tags.length}</span>
          </button>
        </div>

        <div className="manage-watchlist-body scroll-area">
        {manageTab === "tickers" ? (
        <div className="ticker-manager">
          <form className="ticker-add-form" onSubmit={addTicker}>
            <div className="ticker-field">
              <span className="ticker-field-label">Symbol</span>
              <div className="symbol-search-field">
                <input
                  autoFocus
                  aria-autocomplete="list"
                  aria-expanded={symbolSearchOpen}
                  onBlur={() => {
                    window.setTimeout(() => setSymbolSearchOpen(false), 120);
                  }}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, symbol: event.target.value.toUpperCase() }));
                    setSymbolSearchOpen(Boolean(event.target.value.trim()));
                  }}
                  onFocus={() => {
                    if (form.symbol.trim()) {
                      setSymbolSearchOpen(true);
                    }
                  }}
                  placeholder="e.g. NVTS"
                  value={form.symbol}
                />
                {symbolSearchOpen ? (
                  <div className="symbol-search-menu" role="listbox">
                    <div className="symbol-search-scroll">
                      {isSymbolSearching ? <div className="symbol-search-status">Searching symbols...</div> : null}
                      {symbolSearchError ? <div className="symbol-search-status symbol-search-error">{symbolSearchError}</div> : null}
                      {!isSymbolSearching && !symbolSearchError && symbolResults.length === 0 ? (
                        <div className="symbol-search-status">No matching symbols</div>
                      ) : null}
                      {symbolResults.map((result) => {
                        const alreadyAdded = watchlistSymbolSet.has(result.symbol.toUpperCase());
                        return (
                          <button
                            className={`symbol-search-option${alreadyAdded ? " is-added" : ""}`}
                            key={`${result.symbol}-${result.exchange ?? "unknown"}`}
                            disabled={alreadyAdded}
                            aria-disabled={alreadyAdded}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              if (alreadyAdded) {
                                return;
                              }
                              selectSymbolResult(result);
                            }}
                            role="option"
                            type="button"
                          >
                            <span className="symbol-search-option-main">
                              <strong>{result.symbol}</strong>
                              {result.is_etf ? <span className="symbol-search-etf">ETF</span> : null}
                              {alreadyAdded ? <span className="symbol-search-added">Added</span> : null}
                            </span>
                            <span className="symbol-search-option-name">{result.name ?? "Unnamed symbol"}</span>
                            <span className="symbol-search-option-exchange">{result.exchange ?? "Unknown exchange"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="ticker-field">
              <span className="ticker-field-label">Select tags</span>
              <div className="select-tags-row">
                {tags.map((tag) => {
                  const selected = form.selectedTags.some(
                    (name) => name.toLocaleLowerCase() === tag.name.toLocaleLowerCase(),
                  );
                  return (
                    <button
                      aria-pressed={selected}
                      className={`select-tag-pill${selected ? " is-selected" : ""}`}
                      key={tag.id}
                      onClick={() => toggleAddFormTag(tag.name)}
                      type="button"
                    >
                      {tag.name}
                    </button>
                  );
                })}
                {form.selectedTags
                  .filter((name) => !tags.some((tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
                  .map((name) => (
                    <button
                      aria-pressed
                      className="select-tag-pill is-selected"
                      key={`new-${name}`}
                      onClick={() => toggleAddFormTag(name)}
                      type="button"
                    >
                      {name}
                    </button>
                  ))}
                {newTagOpen ? (
                  <input
                    autoFocus
                    className="select-tag-input"
                    onBlur={() => {
                      if (form.newTag.trim()) {
                        addNewFormTag();
                      }
                      setNewTagOpen(false);
                    }}
                    onChange={(event) => setForm((current) => ({ ...current, newTag: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addNewFormTag();
                      } else if (event.key === "Escape") {
                        setForm((current) => ({ ...current, newTag: "" }));
                        setNewTagOpen(false);
                      }
                    }}
                    placeholder="Tag name"
                    value={form.newTag}
                  />
                ) : (
                  <button
                    className="select-tag-pill select-tag-pill-new"
                    onClick={() => setNewTagOpen(true)}
                    type="button"
                  >
                    + New tag…
                  </button>
                )}
              </div>
            </div>

            <label className="ticker-field">
              <span className="ticker-field-label">Notes (optional)</span>
              <input
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="e.g. CPO supply chain watch"
                value={form.notes}
              />
            </label>

            {dialogError ? <p className="form-error">{dialogError}</p> : null}

            <button className="action-button ticker-add-submit" disabled={isSaving} type="submit">
              Add to watchlist
            </button>
          </form>

          <section className="ticker-existing">
            <p className="ticker-existing-label">Existing tickers</p>
            <p className="ticker-existing-help">
              Delete removes only the watchlist entry. Imported IBKR data is kept. Held positions are locked.
            </p>
            {items && items.length > 0 ? (
              <div className="ticker-existing-list">
                {items.slice(0, tickerRenderLimit).map((item) => (
                  <div className="ticker-row" key={item.id}>
                    <div className="ticker-row-main">
                      <div className="ticker-row-head">
                        <strong>{item.symbol}</strong>
                        {item.has_position ? (
                          <>
                            <span className="ticker-row-holding">Holding</span>
                            <span
                              className="ticker-row-ibkr"
                              title="Held positions sync from IBKR and can't be removed."
                            >
                              🔒 IBKR
                            </span>
                          </>
                        ) : (
                          <span className="ticker-row-noposition">No position</span>
                        )}
                      </div>
                      {item.tags.length > 0 ? (
                        <div className="ticker-row-tags">
                          {item.tags.map((tag) => (
                            <span
                              className="tag-pill soft-chip watchlist-table-tag"
                              key={tag}
                              style={{ backgroundColor: tagColor(tag, tags) }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="ticker-row-actions">
                      <button
                        aria-label={`Edit ${item.symbol}`}
                        className="icon-action"
                        disabled={isSaving}
                        onClick={() => startManagedTickerEdit(item)}
                        title="Edit ticker"
                        type="button"
                      >
                        ✎
                      </button>
                      <button
                        aria-label={`Delete ${item.symbol}`}
                        className="icon-action"
                        disabled={isSaving || item.has_position}
                        onClick={() => deleteTicker(item.symbol)}
                        title={
                          item.has_position
                            ? "Held positions sync from IBKR and can't be removed."
                            : "Delete ticker (keeps imported IBKR data)"
                        }
                        type="button"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
                {tickerRenderLimit < items.length ? (
                  <div className="ticker-existing-sentinel" ref={tickerSentinelRef} aria-hidden="true" />
                ) : null}
              </div>
            ) : (
              <span className="tag-editor-empty">No tickers tracked yet.</span>
            )}
          </section>
        </div>
        ) : null}

        {manageTab === "tags" ? (
        <div className="tag-manager">
          <section className="tag-manager-section">
            <span className="ticker-field-label">Add tags</span>
            <form className="tag-add-row" onSubmit={addTags}>
              <input
                onChange={(event) => setTagForm(event.target.value)}
                placeholder="CPO, Optical, AI Infra"
                value={tagForm}
              />
              <button className="action-button" disabled={isSaving} type="submit">
                Add tags
              </button>
            </form>
          </section>

          <section className="tag-manager-section">
            <span className="ticker-field-label">System filters</span>
            <div className="tag-system-banner">
              <span className="tag-system-lock" aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </span>
              <div className="tag-system-body">
                <div className="tag-system-pills">
                  <span className="tag-system-pill">All</span>
                  <span className="tag-system-pill">Holding</span>
                </div>
                <p>Built-in, can&apos;t be renamed or deleted.</p>
              </div>
            </div>
          </section>

          <section className="tag-manager-section">
            <span className="ticker-field-label">Custom tags</span>
            <p className="tag-manager-help">
              Deleting a tag is global: it&apos;s removed from every ticker, but the tickers stay.
            </p>
            {tags.length > 0 ? (
              <div className="tag-pill-list">
                {tags.map((tag) =>
                  editingTagId === tag.id ? (
                    <span className="tag-manage-pill is-editing" key={tag.id}>
                      <input
                        autoFocus
                        className="tag-manage-pill-input"
                        onChange={(event) => setEditingTagName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            saveTagEdit(tag.id);
                          } else if (event.key === "Escape") {
                            setEditingTagId(null);
                          }
                        }}
                        value={editingTagName}
                      />
                      <button
                        aria-label="Save tag name"
                        className="tag-manage-pill-act"
                        disabled={isSaving}
                        onClick={() => saveTagEdit(tag.id)}
                        title="Save"
                        type="button"
                      >
                        ✓
                      </button>
                      <button
                        aria-label="Cancel rename"
                        className="tag-manage-pill-act"
                        disabled={isSaving}
                        onClick={() => setEditingTagId(null)}
                        title="Cancel"
                        type="button"
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <span className="tag-manage-pill-wrap" key={tag.id}>
                      <button
                        aria-expanded={tagMenu?.id === tag.id}
                        aria-haspopup="menu"
                        aria-label={`Tag ${tag.name} options`}
                        className={`tag-pill soft-chip watchlist-table-tag tag-manage-pill tag-manage-pill-trigger${tagMenu?.id === tag.id ? " is-open" : ""}`}
                        disabled={isSaving}
                        onClick={(event) => toggleTagMenu(tag.id, event)}
                        style={{ backgroundColor: tagColor(tag.name, tags) }}
                        type="button"
                      >
                        <span className="tag-manage-pill-name">{tag.name}</span>
                        <span className="tag-manage-pill-count">{tag.count}</span>
                        <span className="tag-manage-pill-caret" aria-hidden="true">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </span>
                      </button>
                      {tagMenu?.id === tag.id ? (
                        <div
                          className="tag-menu-popover"
                          role="menu"
                          aria-label={`${tag.name} actions`}
                          style={{ left: tagMenu.left, top: tagMenu.top }}
                        >
                          <button
                            className="tag-menu-item"
                            disabled={isSaving}
                            onClick={() => startTagEdit(tag)}
                            role="menuitem"
                            type="button"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                            Rename
                          </button>
                          <button
                            className="tag-menu-item tag-menu-item-danger"
                            disabled={isSaving}
                            onClick={() => {
                              setTagMenu(null);
                              deleteGlobalTag(tag);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M3 6h18" />
                              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            </svg>
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </span>
                  ),
                )}
              </div>
            ) : (
              <span className="tag-editor-empty">No custom tags yet.</span>
            )}
          </section>

          {dialogError ? <p className="form-error">{dialogError}</p> : null}
        </div>
        ) : null}
        </div>
      </BaseModal>

      <BaseModal
        description="Update notes and tags for this ticker. Removing a tag only unlinks it here."
        isOpen={editingSymbol !== null}
        onClose={() => setEditingSymbol(null)}
        title="Edit Ticker"
      >
        <form className="modal-form" onSubmit={saveEdit}>
          <label className="filter-field">
            <span>Symbol</span>
            <input readOnly value={editForm.symbol} />
          </label>
          <label className="filter-field">
            <span>Notes</span>
            <input
              onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Optional note"
              value={editForm.notes}
            />
          </label>
          <div className="tag-editor">
            <span className="tag-editor-label">Tags</span>
            <p className="tag-editor-note">Remove from this ticker only. Global tag deletion is in Manage watchlist → Tags.</p>
            <div className="tag-editor-list">
              {editForm.selectedTags.length > 0 ? (
                editForm.selectedTags.map((tag) => (
                  <span className="tag-pill tag-pill-editable" key={tag} style={{ backgroundColor: tagColor(tag, tags) }}>
                    {tag}
                    <button aria-label={`Remove ${tag}`} onClick={() => removeEditTag(tag)} type="button">
                      x
                    </button>
                  </span>
                ))
              ) : (
                <span className="tag-editor-empty">No tags selected.</span>
              )}
            </div>
            <div className="tag-editor-add-row">
              <input
                list="watchlist-existing-tags"
                onChange={(event) => setEditForm((current) => ({ ...current, tagInput: event.target.value }))}
                placeholder="Add tag, or use commas for many"
                value={editForm.tagInput}
              />
              <datalist id="watchlist-existing-tags">
                {tags.map((tag) => (
                  <option key={tag.name} value={tag.name} />
                ))}
              </datalist>
              <button className="secondary-button" onClick={addEditInputTags} type="button">
                Add Tag
              </button>
            </div>
          </div>
          {dialogError ? <p className="form-error">{dialogError}</p> : null}
          <div className="modal-actions">
            <button className="secondary-button" disabled={isSaving} onClick={() => setEditingSymbol(null)} type="button">
              Cancel
            </button>
            <button className="action-button" disabled={isSaving} type="submit">
              Save
            </button>
          </div>
        </form>
      </BaseModal>
    </>
  );
}
