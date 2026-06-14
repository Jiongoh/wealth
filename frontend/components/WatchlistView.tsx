"use client";

import Link from "next/link";
import { type FormEvent, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BaseModal } from "@/components/BaseModal";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import {
  api,
  type DecimalValue,
  type MarketQuote,
  type MarketSubscriptionPlan,
  type SymbolSearchResult,
  type WatchlistItem,
  type WatchlistTag,
} from "@/lib/api";

type SubscriptionSource = "auto" | "manual" | "none";

// Warn once realtime subscriptions reach this share of the Alpaca free-tier cap.
const SUBSCRIPTION_WARN_RATIO = 0.8;

function SubscriptionUsageBanner({ plan, onManage }: { plan: MarketSubscriptionPlan; onManage: () => void }) {
  const max = Math.max(plan.max_symbols, 1);
  const overCap = plan.overflow_count > 0;
  const nearCap = !overCap && plan.subscribed_count >= max * SUBSCRIPTION_WARN_RATIO;
  const tone = overCap ? "is-over" : nearCap ? "is-near" : "is-ok";
  const manualCount = Math.max(plan.subscribed_count - plan.holdings_count, 0);
  // Split the bar into an auto (holdings, green) segment and a manual (blue)
  // segment; the grey track underneath shows the remaining free slots.
  const autoPct = Math.min(plan.holdings_count / max, 1) * 100;
  const manualPct = Math.min(manualCount / max, 1) * 100;
  return (
    <section className={`subscription-usage ${tone}`} aria-label="Realtime subscription usage">
      <div className="subscription-usage-main">
        <div className="subscription-usage-head">
          <span className="subscription-usage-title">Market data subscriptions</span>
          <span className="subscription-usage-count">
            {plan.subscribed_count} / {plan.max_symbols} symbols used
          </span>
        </div>
        <div className="subscription-usage-bar" role="presentation">
          <span className="subscription-usage-seg subscription-usage-seg-auto" style={{ width: `${autoPct}%` }} />
          <span className="subscription-usage-seg subscription-usage-seg-manual" style={{ width: `${manualPct}%` }} />
        </div>
        <p className="subscription-usage-detail">
          {plan.holdings_count} holdings auto-subscribed · {manualCount} manually subscribed
          {overCap
            ? ` · ${plan.overflow_count} over limit: ${plan.excluded_symbols.join(", ")}`
            : nearCap
              ? " · approaching the free-tier limit"
              : ""}
        </p>
      </div>
      <button className="secondary-button subscription-usage-manage" onClick={onManage} type="button">
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
const PAGE_SIZE = 10;
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

type TagPopoverPosition = {
  left: number;
  top: number;
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
  const [page, setPage] = useState(1);
  const [manageTickersOpen, setManageTickersOpen] = useState(false);
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [form, setForm] = useState<TickerForm>(EMPTY_TICKER_FORM);
  const [tagForm, setTagForm] = useState("");
  const [activeTickerPopoverSymbol, setActiveTickerPopoverSymbol] = useState<string | null>(null);
  const [tickerPopoverPosition, setTickerPopoverPosition] = useState<TagPopoverPosition | null>(null);
  const [activeTagPopoverId, setActiveTagPopoverId] = useState<number | null>(null);
  const [tagPopoverPosition, setTagPopoverPosition] = useState<TagPopoverPosition | null>(null);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
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
  const [manageSubscriptionOpen, setManageSubscriptionOpen] = useState(false);
  const [tagFilterExpanded, setTagFilterExpanded] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
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
    if (!manageTickersOpen) {
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
  }, [form.symbol, manageTickersOpen]);

  useEffect(() => {
    if (!manageTickersOpen || activeTickerPopoverSymbol === null) {
      return;
    }

    function closePopoverOnOutsideClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-ticker-popover-root="true"], [data-ticker-action-popover="true"]')) {
        return;
      }
      setActiveTickerPopoverSymbol(null);
      setTickerPopoverPosition(null);
    }

    document.addEventListener("mousedown", closePopoverOnOutsideClick);
    return () => document.removeEventListener("mousedown", closePopoverOnOutsideClick);
  }, [activeTickerPopoverSymbol, manageTickersOpen]);

  useEffect(() => {
    if (!manageTickersOpen || activeTickerPopoverSymbol === null) {
      return;
    }

    function closePopoverOnViewportChange() {
      setActiveTickerPopoverSymbol(null);
      setTickerPopoverPosition(null);
    }

    window.addEventListener("resize", closePopoverOnViewportChange);
    window.addEventListener("scroll", closePopoverOnViewportChange, true);
    return () => {
      window.removeEventListener("resize", closePopoverOnViewportChange);
      window.removeEventListener("scroll", closePopoverOnViewportChange, true);
    };
  }, [activeTickerPopoverSymbol, manageTickersOpen]);

  useEffect(() => {
    if (!manageTagsOpen || activeTagPopoverId === null) {
      return;
    }

    function closePopoverOnOutsideClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-tag-popover-root="true"], [data-tag-action-popover="true"]')) {
        return;
      }
      setActiveTagPopoverId(null);
      setTagPopoverPosition(null);
      setEditingTagId(null);
    }

    document.addEventListener("mousedown", closePopoverOnOutsideClick);
    return () => document.removeEventListener("mousedown", closePopoverOnOutsideClick);
  }, [activeTagPopoverId, manageTagsOpen]);

  useEffect(() => {
    if (!manageTagsOpen || activeTagPopoverId === null) {
      return;
    }

    function closePopoverOnViewportChange() {
      setActiveTagPopoverId(null);
      setTagPopoverPosition(null);
      setEditingTagId(null);
    }

    window.addEventListener("resize", closePopoverOnViewportChange);
    window.addEventListener("scroll", closePopoverOnViewportChange, true);
    return () => {
      window.removeEventListener("resize", closePopoverOnViewportChange);
      window.removeEventListener("scroll", closePopoverOnViewportChange, true);
    };
  }, [activeTagPopoverId, manageTagsOpen]);

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
    setIsSaving(true);
    setDialogError(null);
    try {
      await api.createWatchlistTicker({
        symbol,
        tags: parsedTags,
        display_name: form.displayName.trim() || null,
        notes: form.notes.trim() || null,
      });
      resetTickerForm();
      setPage(1);
      await loadWatchlist();
    } catch (requestError: unknown) {
      setDialogError(requestError instanceof Error ? requestError.message : "Request failed.");
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
      setPage(1);
    } catch (requestError: unknown) {
      setDialogError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setIsSaving(false);
    }
  }

  function startTagEdit(tag: WatchlistTag) {
    setEditingTagId(tag.id);
    setEditingTagName(tag.name);
    setDialogError(null);
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
      setActiveTagPopoverId(null);
      setTagPopoverPosition(null);
      setSelectedTags([]);
      setHoldingOnly(false);
      setPage(1);
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
      setActiveTagPopoverId(null);
      setTagPopoverPosition(null);
      setEditingTagId(null);
      setEditingTagName("");
      setSelectedTags([]);
      setHoldingOnly(false);
      setPage(1);
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
      setPage(1);
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
      if (activeTickerPopoverSymbol === symbol) {
        setActiveTickerPopoverSymbol(null);
        setTickerPopoverPosition(null);
      }
      setPage(1);
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
    setPage(1);
  }

  function toggleHoldingFilter() {
    setHoldingOnly((current) => !current);
    setFilterNotice(null);
    setPage(1);
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
    setPage(1);
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
    setSymbolResults([]);
    setSymbolSearchOpen(false);
    setIsSymbolSearching(false);
    setSymbolSearchError(null);
  }

  function openManageTickers() {
    setDialogError(null);
    setActiveTickerPopoverSymbol(null);
    setTickerPopoverPosition(null);
    setManageTickersOpen(true);
  }

  function closeManageTickers() {
    setManageTickersOpen(false);
    setDialogError(null);
    setActiveTickerPopoverSymbol(null);
    setTickerPopoverPosition(null);
    resetTickerForm();
  }

  function openManageTags() {
    setDialogError(null);
    setEditingTagId(null);
    setEditingTagName("");
    setActiveTagPopoverId(null);
    setTagPopoverPosition(null);
    setManageTagsOpen(true);
  }

  function toggleTickerPopover(symbol: string, event: ReactMouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const popoverWidth = 178;
    const safeGutter = 12;
    const maxLeft = window.scrollX + window.innerWidth - popoverWidth - safeGutter;
    const minLeft = safeGutter + window.scrollX;
    const nextLeft = Math.max(minLeft, Math.min(rect.left + window.scrollX, Math.max(minLeft, maxLeft)));

    setDialogError(null);
    setTickerPopoverPosition({
      left: nextLeft,
      top: rect.bottom + window.scrollY + 9,
    });
    setActiveTickerPopoverSymbol((current) => (current === symbol ? null : symbol));
  }

  function startManagedTickerEdit(row: WatchlistItem) {
    setActiveTickerPopoverSymbol(null);
    setTickerPopoverPosition(null);
    setManageTickersOpen(false);
    startEdit(row);
  }

  function toggleTagPopover(tagId: number, event: ReactMouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const popoverWidth = 232;
    const safeGutter = 12;
    const maxLeft = window.scrollX + window.innerWidth - popoverWidth - safeGutter;
    const minLeft = safeGutter + window.scrollX;
    const nextLeft = Math.max(minLeft, Math.min(rect.left + window.scrollX, Math.max(minLeft, maxLeft)));

    setDialogError(null);
    setEditingTagId(null);
    setTagPopoverPosition({
      left: nextLeft,
      top: rect.bottom + window.scrollY + 9,
    });
    setActiveTagPopoverId((current) => (current === tagId ? null : tagId));
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
      .map((item) => ({
        ...item,
        status: item.has_position ? "Holding" : "No Position",
        actions: item.symbol,
        tagList: item.tags.join(", "),
      }));
  }, [debouncedSearch, holdingOnly, items, selectedTags]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const activePopoverTicker = items?.find((item) => item.symbol === activeTickerPopoverSymbol) ?? null;
  const activePopoverTag = tags.find((tag) => tag.id === activeTagPopoverId) ?? null;
  const holdingCount = items?.filter((item) => item.has_position).length ?? 0;
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

  function priceFor(item: WatchlistItem): DecimalValue {
    if (!isSubscribed(item)) {
      return null;
    }
    const quote = quotes[item.symbol.toUpperCase()];
    return quote?.last_price ?? item.current_price;
  }

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

  const columns: DataTableColumn<WatchlistRow>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (_, row) => (
        <div className="watchlist-symbol-cell">
          <div className="watchlist-symbol-line">
            <Link className="watchlist-symbol-link" href={`/details/${encodeURIComponent(row.symbol.toUpperCase())}`}>
              {row.symbol}
              <span className="watchlist-symbol-arrow" aria-hidden="true">↗</span>
            </Link>
            <SubscriptionBadge source={subscriptionSource(row)} />
          </div>
          {row.display_name ? <span className="watchlist-symbol-company">{row.display_name}</span> : null}
        </div>
      ),
    },
    {
      key: "tagList",
      header: "Tags",
      render: (_, row) => (
        <span className="tag-list">
          {row.tags.length > 0
            ? row.tags.map((tag) => (
                <span className="tag-pill soft-chip watchlist-table-tag" key={tag} style={{ backgroundColor: tagColor(tag, tags) }}>
                  {tag}
                </span>
              ))
            : "--"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (_, row) =>
        row.has_position ? (
          <span className="status-pill status-pill-holding">Holding</span>
        ) : (
          <span className="status-pill" title="No current position for this ticker.">
            No Position
          </span>
        ),
    },
    {
      key: "current_price",
      header: "Price",
      align: "right",
      render: (_, row) => {
        const price = priceFor(row);
        return price === null ? <span className="watchlist-muted">—</span> : <span>{formatNumber(price)}</span>;
      },
    },
    {
      key: "market_value",
      header: "Mkt value",
      align: "right",
      render: (value, row) =>
        row.has_position ? <span>{formatNumber(value as DecimalValue)}</span> : <span className="watchlist-muted">—</span>,
    },
    { key: "notes", header: "Notes", render: (value) => String(value ?? "--") },
    {
      key: "actions",
      header: "Actions",
      align: "center",
      render: (_, row) => (
        <span className="watchlist-actions">
          <Link className="small-action-link" href={`/details/${encodeURIComponent(row.symbol.toUpperCase())}`}>
            Details
          </Link>
          <button
            aria-label={`Edit ${row.symbol}`}
            className="icon-action"
            disabled={isSaving}
            onClick={() => startEdit(row)}
            title="Edit ticker"
            type="button"
          >
            ✎
          </button>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Personal research</p>
          <h1>Watchlist</h1>
          <p className="page-description">Track the tickers you care about, with custom tags and portfolio links.</p>
        </div>
        <div className="watchlist-header-actions">
          <button className="secondary-button" onClick={openManageTags} type="button">
            Manage tags
          </button>
          <button className="action-button" onClick={openManageTickers} type="button">
            Add ticker
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
        <p className="tag-filter-info">All / Holding are system filters and can&apos;t be edited or removed.</p>
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
            <DataTable
              columns={columns}
              emptyMessage="No tickers match the selected filter."
              getRowKey={(row) => row.id}
              rows={pagedRows}
            />
            {totalPages > 1 ? (
              <div className="pagination-controls">
                <button className="secondary-button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">
                  Previous
                </button>
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <button className="secondary-button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} type="button">
                  Next
                </button>
              </div>
            ) : null}
            <div className="watchlist-table-footer">
              <span>
                Showing {pagedRows.length} of {rows.length} tickers · prices delayed 15 min unless subscribed
              </span>
              {subscriptionPlan ? (
                <span>
                  {subscriptionPlan.subscribed_count} / {subscriptionPlan.max_symbols} realtime slots used
                </span>
              ) : null}
            </div>
          </>
        )}
      </section>

      {subscriptionPlan ? (
        <section className="panel subscription-pool-card">
          <div className="panel-header">
            <div>
              <h2>Subscription pool</h2>
              <p>
                Symbols receiving market data. Holdings subscribe automatically; add manual symbols up to the{" "}
                {subscriptionPlan.max_symbols}-symbol limit.
              </p>
            </div>
            <button className="secondary-button" onClick={openManageTickers} type="button">
              Add symbol
            </button>
          </div>
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
        </section>
      ) : null}

      <BaseModal
        className="manage-subscription-modal"
        description={
          subscriptionPlan
            ? `${subscriptionPlan.subscribed_count} / ${subscriptionPlan.max_symbols} symbols used. Holdings subscribe automatically and are locked.`
            : "Holdings subscribe automatically and are locked."
        }
        isOpen={manageSubscriptionOpen}
        onClose={() => setManageSubscriptionOpen(false)}
        title="Manage subscription"
      >
        <div className="subscription-manage-list">
          {(items ?? []).length === 0 ? <EmptyState message="No watchlist tickers yet." /> : null}
          {(items ?? []).map((item) => {
            const source = subscriptionSource(item);
            const locked = item.has_position;
            const on = source !== "none";
            const disableEnable = !on && !locked && capReached;
            return (
              <div className="subscription-manage-row" key={item.id}>
                <div className="subscription-manage-symbol">
                  <strong>{item.symbol}</strong>
                  {item.display_name ? <span>{item.display_name}</span> : null}
                </div>
                {locked ? (
                  <span className="sub-badge sub-badge-auto" title="Auto-subscribed because you hold this position">
                    RT · locked
                  </span>
                ) : (
                  <button
                    className={`subscription-toggle${on ? " is-on" : ""}`}
                    disabled={isSaving || disableEnable}
                    onClick={() => toggleSubscription(item)}
                    title={disableEnable ? "Subscription limit reached" : on ? "Click to unsubscribe" : "Click to subscribe"}
                    type="button"
                  >
                    {on ? "Subscribed" : disableEnable ? "Limit reached" : "Subscribe"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </BaseModal>

      <BaseModal
        className="manage-tickers-modal"
        description="Add, edit, or delete tickers in your personal watchlist. Pick existing tags or create new ones."
        isOpen={manageTickersOpen}
        onClose={closeManageTickers}
        title="Add ticker"
      >
        <div className="tag-manager manage-tickers-manager">
          <section className="tag-manager-section manage-tickers-fixed-section">
            <h3>Add Ticker</h3>
            <form className="modal-form" onSubmit={addTicker}>
              <div className="filter-field">
                <span>Symbol</span>
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
                    placeholder="COHR"
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
                        {symbolResults.map((result) => (
                          <button
                            className="symbol-search-option"
                            key={`${result.symbol}-${result.exchange ?? "unknown"}`}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              selectSymbolResult(result);
                            }}
                            role="option"
                            type="button"
                          >
                            <span className="symbol-search-option-main">
                              <strong>{result.symbol}</strong>
                              {result.is_etf ? <span className="symbol-search-etf">ETF</span> : null}
                            </span>
                            <span className="symbol-search-option-name">{result.name ?? "Unnamed symbol"}</span>
                            <span className="symbol-search-option-exchange">{result.exchange ?? "Unknown exchange"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <label className="filter-field">
                <span>Company name</span>
                <input
                  onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="Optional — auto-filled from symbol"
                  value={form.displayName}
                />
              </label>
              <div className="filter-field">
                <span>Tags</span>
                <div className="add-ticker-tags">
                  {tags.length === 0 ? (
                    <span className="tag-manager-help">No tags yet — create one below.</span>
                  ) : (
                    tags.map((tag) => {
                      const checked = form.selectedTags.some(
                        (selected) => selected.toLocaleLowerCase() === tag.name.toLocaleLowerCase(),
                      );
                      return (
                        <button
                          aria-pressed={checked}
                          className={`tag-checkbox${checked ? " is-checked" : ""}`}
                          key={tag.id}
                          onClick={() => toggleAddFormTag(tag.name)}
                          type="button"
                        >
                          <span className="tag-checkbox-dot" style={{ backgroundColor: tag.color ?? DEFAULT_TAG_COLOR }} />
                          {checked ? <span className="tag-filter-check">✓</span> : null}
                          {tag.name}
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="add-ticker-newtag">
                  <input
                    onChange={(event) => setForm((current) => ({ ...current, newTag: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addNewFormTag();
                      }
                    }}
                    placeholder="New tag"
                    value={form.newTag}
                  />
                  <button className="secondary-button" disabled={!form.newTag.trim()} onClick={addNewFormTag} type="button">
                    Add tag
                  </button>
                </div>
                {form.selectedTags.length > 0 ? (
                  <div className="add-ticker-selected">
                    {form.selectedTags.map((tag) => (
                      <span className="tag-pill soft-chip" key={tag} style={{ backgroundColor: tagColor(tag, tags) }}>
                        {tag}
                        <button aria-label={`Remove ${tag}`} onClick={() => toggleAddFormTag(tag)} type="button">
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <label className="filter-field">
                <span>Notes</span>
                <input
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Optional note"
                  value={form.notes}
                />
              </label>
              <div className="modal-actions">
                <button className="action-button" disabled={isSaving} type="submit">
                  Add
                </button>
              </div>
            </form>
          </section>

          <div className="manage-tickers-scroll-body">
            <section className="tag-manager-section manage-tickers-list-section">
              <h3>Existing Tickers</h3>
              <p className="tag-manager-help">
                Delete here removes only the watchlist ticker. It keeps all imported IBKR data.
              </p>
              <div className="tag-chip-grid ticker-chip-grid" onClick={() => setActiveTickerPopoverSymbol(null)}>
                {items && items.length > 0 ? (
                  items.map((item) => (
                    <div
                      className="tag-chip-wrap"
                      data-ticker-popover-root="true"
                      key={item.id}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button className="tag-chip-button ticker-chip-button soft-chip" onClick={(event) => toggleTickerPopover(item.symbol, event)} type="button">
                        {item.symbol}
                        <span className={item.has_position ? "ticker-chip-status-holding" : undefined}>
                          · {item.has_position ? "Holding" : "No Position"}
                        </span>
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="tag-editor-empty">No tickers tracked yet.</span>
                )}
              </div>
            </section>
          </div>

          {dialogError ? <p className="form-error">{dialogError}</p> : null}
        </div>
      </BaseModal>

      {manageTickersOpen && activePopoverTicker && tickerPopoverPosition
        ? createPortal(
            <div
              className="tag-action-popover tag-action-popover-portal ticker-action-popover"
              data-ticker-action-popover="true"
              style={{ left: tickerPopoverPosition.left, top: tickerPopoverPosition.top }}
            >
              <div className="tag-manager-actions tag-popover-actions">
                <button className="text-action" disabled={isSaving} onClick={() => startManagedTickerEdit(activePopoverTicker)} type="button">
                  Edit
                </button>
                <button
                  className="text-action text-action-danger"
                  disabled={isSaving || activePopoverTicker.has_position}
                  onClick={() => deleteTicker(activePopoverTicker.symbol)}
                  title={
                    activePopoverTicker.has_position
                      ? "Held positions sync from IBKR and can't be removed from the watchlist."
                      : undefined
                  }
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}

      <BaseModal
        description="Add, rename, or delete tags globally. Global deletion removes the tag from all tickers."
        isOpen={manageTagsOpen}
        onClose={() => setManageTagsOpen(false)}
        title="Manage Tags"
      >
        <div className="tag-manager">
          <section className="tag-manager-section">
            <h3>Add Tags</h3>
            <form className="modal-form" onSubmit={addTags}>
              <label className="filter-field">
                <span>Tag names</span>
                <input
                  autoFocus
                  onChange={(event) => setTagForm(event.target.value)}
                  placeholder="CPO, Optical, AI Infra"
                  value={tagForm}
                />
              </label>
              <div className="modal-actions">
                <button className="action-button" disabled={isSaving} type="submit">
                  Add
                </button>
              </div>
            </form>
          </section>

          <section className="tag-manager-section">
            <h3>Existing Tags</h3>
            <p className="tag-manager-help">Delete here is global. It removes the tag from all tickers, but keeps every ticker.</p>
            <div className="tag-chip-grid" onClick={() => setActiveTagPopoverId(null)}>
              {tags.length > 0 ? (
                tags.map((tag) => (
                  <div className="tag-chip-wrap" data-tag-popover-root="true" key={tag.id} onClick={(event) => event.stopPropagation()}>
                    <button
                      className="tag-chip-button soft-chip"
                      onClick={(event) => toggleTagPopover(tag.id, event)}
                      style={{ backgroundColor: tag.color ?? DEFAULT_TAG_COLOR }}
                      type="button"
                    >
                      {tag.name} <span>· {tag.count}</span>
                    </button>
                  </div>
                ))
              ) : (
                <span className="tag-editor-empty">No tags created yet.</span>
              )}
            </div>
          </section>

          {dialogError ? <p className="form-error">{dialogError}</p> : null}
          <div className="modal-actions">
            <button className="secondary-button" disabled={isSaving} onClick={() => setManageTagsOpen(false)} type="button">
              Close
            </button>
          </div>
        </div>
      </BaseModal>

      {manageTagsOpen && activePopoverTag && tagPopoverPosition
        ? createPortal(
            <div
              className="tag-action-popover tag-action-popover-portal"
              data-tag-action-popover="true"
              style={{ left: tagPopoverPosition.left, top: tagPopoverPosition.top }}
            >
              {editingTagId === activePopoverTag.id ? (
                <div className="tag-popover-edit">
                  <input
                    className="tag-manager-input"
                    onChange={(event) => setEditingTagName(event.target.value)}
                    value={editingTagName}
                  />
                  <div className="tag-manager-actions">
                    <button className="text-action" disabled={isSaving} onClick={() => saveTagEdit(activePopoverTag.id)} type="button">
                      Save
                    </button>
                    <button className="text-action" disabled={isSaving} onClick={() => setEditingTagId(null)} type="button">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="tag-manager-actions tag-popover-actions">
                  <button className="text-action" disabled={isSaving} onClick={() => startTagEdit(activePopoverTag)} type="button">
                    Edit
                  </button>
                  <button className="text-action text-action-danger" disabled={isSaving} onClick={() => deleteGlobalTag(activePopoverTag)} type="button">
                    Delete
                  </button>
                </div>
              )}
            </div>,
            document.body,
          )
        : null}

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
            <p className="tag-editor-note">Remove from this ticker only. Global tag deletion is in Manage Tags.</p>
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
