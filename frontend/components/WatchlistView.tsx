"use client";

import Link from "next/link";
import { type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
// A wide, hue-spread palette so tag colours are auto-assigned (no manual picker)
// with strong visual separation. Ordered so adjacent entries contrast; a colour
// only repeats after the whole palette (14) is used, never after a few tags.
const TAG_COLORS = [
  "#cc785c", // coral
  "#5db872", // green
  "#6c8fd6", // blue
  "#e3b341", // amber
  "#a884d4", // purple
  "#5db8a6", // teal
  "#d47b8f", // rose
  "#a3b35a", // olive
  "#cf7bad", // magenta
  "#5aa8bf", // cyan
  "#e0955a", // orange
  "#7b7fd0", // indigo
  "#a98a6b", // taupe
  "#8e8b82", // slate
];

// Re-colour a list of tags from the palette by position, so the set is evenly
// spread and stable across reloads (index-based, not order-sensitive per render).
function recolorTags(list: WatchlistTag[]): WatchlistTag[] {
  return list.map((tag, index) => ({ ...tag, color: TAG_COLORS[index % TAG_COLORS.length] }));
}

// Pick the palette colour used by the fewest existing tags (ties → earliest in
// the palette). Guarantees a new tag gets a maximally-distinct colour and that
// nothing repeats until every palette colour has been used at least once.
function pickTagColor(existing: WatchlistTag[]): string {
  const counts = new Map<string, number>(TAG_COLORS.map((color) => [color, 0]));
  for (const tag of existing) {
    if (tag.color && counts.has(tag.color)) {
      counts.set(tag.color, (counts.get(tag.color) ?? 0) + 1);
    }
  }
  let best = TAG_COLORS[0];
  let bestCount = Infinity;
  for (const color of TAG_COLORS) {
    const count = counts.get(color) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      best = color;
    }
  }
  return best;
}

const EMPTY_TICKER_FORM: TickerForm = { symbol: "", displayName: "", selectedTags: [], newTag: "", notes: "" };

// Header-less panel modal — the design's management surfaces supply their own
// headers (Done button, back arrow, step counters), so this only provides the
// overlay, scroll-lock, and Escape handling.
function PanelModal({
  open,
  onClose,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) {
    return null;
  }
  return (
    <div className="modal-overlay" onMouseDown={onClose} role="presentation">
      <section
        aria-modal="true"
        className={`wl-panel${className ? ` ${className}` : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        {children}
      </section>
    </div>
  );
}

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

// Research Notes: a theme groups a few tracked symbols with a short thesis.
type ResearchTheme = {
  id: string;
  name: string;
  symbols: string[];
  starred: boolean;
  updated: string;
  summary: string;
  bullets: string[];
};

type SortMode = "recent" | "symbol" | "price" | "change";
type ViewMode = "grid" | "list";

const SORT_LABELS: Record<SortMode, string> = {
  recent: "Recent",
  symbol: "Symbol",
  price: "Price",
  change: "Change",
};

// ---------------------------------------------------------------------------
// Local-preview fallback. The watchlist API (and its Postgres) only runs on the
// deployed server; a bare `next dev` has no backend, so requests fail. When that
// happens we render this representative dataset instead of an error, so the page
// still previews faithfully. On a real deployment the API responds first and none
// of this is used.
// ---------------------------------------------------------------------------
const DEMO_TAGS: WatchlistTag[] = [
  { id: 2, name: "AI", count: 1, color: "#8fa9ff" },
  { id: 3, name: "Aerospace", count: 2, color: "#c9a2ff" },
  { id: 4, name: "CPU", count: 1, color: "#f0b46b" },
  { id: 5, name: "Cloud", count: 1, color: "#8fd6e0" },
  { id: 6, name: "DRAM", count: 2, color: "#f5c84c" },
  { id: 7, name: "ETF", count: 2, color: "#b7c98f" },
  { id: 8, name: "Optics", count: 3, color: "#ff9db0" },
  { id: 9, name: "Photonics", count: 2, color: "#ffb17a" },
  { id: 10, name: "Memory", count: 4, color: "#e0b0ff" },
  { id: 11, name: "NAND", count: 1, color: "#9fd8a8" },
  { id: 12, name: "Storage", count: 2, color: "#7fc4c9" },
  { id: 13, name: "Networking", count: 1, color: "#a0b4ff" },
  { id: 14, name: "Datacenter", count: 2, color: "#d0a06b" },
  { id: 15, name: "Space", count: 1, color: "#b79dff" },
  { id: 16, name: "Foundry", count: 1, color: "#e6c07a" },
  { id: 17, name: "HBM", count: 1, color: "#efa3c4" },
  { id: 18, name: "Growth", count: 2, color: "#93c98f" },
];

function demoItem(
  id: number,
  symbol: string,
  displayName: string,
  tags: string[],
  hasPosition: boolean,
  realtime: boolean,
  currentPrice: number | null,
): WatchlistItem {
  return {
    id,
    symbol,
    display_name: displayName,
    notes: null,
    realtime_enabled: realtime,
    tags,
    has_position: hasPosition,
    latest_report_date: "2026-06-27",
    position_quantity: hasPosition ? 100 : null,
    current_price: currentPrice,
    market_value: null,
    unrealized_pnl: null,
    updated_at: "2026-07-01T12:00:00Z",
  };
}

const DEMO_ITEMS: WatchlistItem[] = [
  demoItem(1, "LITE", "Lumentum Holdings Inc.", ["Optics", "Photonics"], true, false, 848.0),
  demoItem(2, "MU", "Micron Technology, Inc.", ["Memory", "DRAM", "HBM"], true, false, 1151.95),
  demoItem(3, "QQQM", "Invesco NASDAQ 100 ETF", ["ETF"], true, false, 304.67),
  demoItem(4, "DRAM", "Roundhill Memory ETF", ["ETF", "Memory", "DRAM"], false, true, 78.15),
  demoItem(5, "MRVL", "Marvell Technology Inc.", ["AI", "Networking", "Datacenter"], false, true, 313.51),
  demoItem(6, "NBIS", "Nebius Group N.V.", ["Cloud", "AI", "Growth"], false, true, 285.29),
  demoItem(7, "SNDK", "Sandisk Corporation", ["Storage", "NAND", "Memory"], false, true, 2209.28),
  demoItem(8, "SPCX", "Space Exploration ETF", ["Aerospace", "Space", "Memory"], false, true, 181.69),
  demoItem(9, "AAOI", "Applied Optoelectronics, Inc.", ["Optics"], false, false, null),
  demoItem(10, "COHR", "Coherent Corp. Common Stock", ["Optics", "Photonics"], false, false, null),
];

const DEMO_META: Record<string, { name: string | null; exchange: string | null }> = {
  LITE: { name: "Lumentum Holdings Inc.", exchange: "NASDAQ" },
  MU: { name: "Micron Technology, Inc.", exchange: "NASDAQ" },
  QQQM: { name: "Invesco NASDAQ 100 ETF", exchange: "NASDAQ" },
  DRAM: { name: "Roundhill Memory ETF", exchange: "CBOE BZX" },
  MRVL: { name: "Marvell Technology Inc.", exchange: "NASDAQ" },
  NBIS: { name: "Nebius Group N.V.", exchange: "NASDAQ" },
  SNDK: { name: "Sandisk Corporation", exchange: "NASDAQ" },
  SPCX: { name: "Space Exploration ETF", exchange: "NASDAQ" },
  AAOI: { name: "Applied Optoelectronics, Inc.", exchange: "NASDAQ" },
  COHR: { name: "Coherent Corp. Common Stock", exchange: "NYSE" },
};

const DEMO_PLAN: MarketSubscriptionPlan = {
  symbols: ["LITE", "MU", "QQQM", "AVGO", "DRAM", "MRVL", "NBIS", "SNDK", "SPCX"],
  max_symbols: 30,
  total_candidates: 10,
  subscribed_count: 9,
  overflow_count: 0,
  holdings_count: 4,
  watchlist_realtime_count: 5,
  excluded_symbols: [],
  warnings: [],
};

function demoQuote(symbol: string, last: number, changePct: number): MarketQuote {
  const previous = last / (1 + changePct / 100);
  return {
    symbol,
    provider: "demo",
    feed: "demo",
    market_session: "regular",
    last_price: last,
    bid_price: last,
    ask_price: last,
    last_bar_close: previous,
    previous_close: previous,
    updated_at: "2026-07-01T12:00:00Z",
  };
}

const DEMO_QUOTES: MarketQuote[] = [
  demoQuote("LITE", 848.0, -3.42),
  demoQuote("MU", 1151.95, 6.89),
  demoQuote("QQQM", 304.67, 1.37),
  demoQuote("DRAM", 78.15, 7.95),
  demoQuote("MRVL", 313.51, 5.31),
  demoQuote("NBIS", 285.29, -1.81),
  demoQuote("SNDK", 2209.28, 9.91),
  demoQuote("SPCX", 181.69, -6.92),
];

// Demo symbol-search results + prices, so the offline Add-symbol flow works.
const DEMO_SEARCH: SymbolSearchResult[] = [
  { symbol: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", is_etf: false, source_file: null },
  { symbol: "TSLA", name: "Tesla, Inc.", exchange: "NASDAQ", is_etf: false, source_file: null },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", exchange: "NYSE Arca", is_etf: true, source_file: null },
  { symbol: "SOXL", name: "Direxion Daily Semicon Bull 3X", exchange: "NYSE Arca", is_etf: true, source_file: null },
  { symbol: "AMZN", name: "Amazon.com, Inc.", exchange: "NASDAQ", is_etf: false, source_file: null },
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", is_etf: false, source_file: null },
  { symbol: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ", is_etf: false, source_file: null },
  { symbol: "AVGO", name: "Broadcom Inc.", exchange: "NASDAQ", is_etf: false, source_file: null },
  { symbol: "GOOGL", name: "Alphabet Inc.", exchange: "NASDAQ", is_etf: false, source_file: null },
  { symbol: "META", name: "Meta Platforms, Inc.", exchange: "NASDAQ", is_etf: false, source_file: null },
];
const DEMO_PRICE: Record<string, { price: number; change: number }> = {
  NVDA: { price: 124.06, change: 2.31 },
  TSLA: { price: 171.41, change: -1.02 },
  VOO: { price: 475.64, change: 0.3 },
  SOXL: { price: 52.91, change: 3.21 },
  AMZN: { price: 186.21, change: 0.71 },
  AAPL: { price: 213.3, change: 0.44 },
  MSFT: { price: 449.78, change: 1.12 },
  AVGO: { price: 1720.0, change: 2.05 },
  GOOGL: { price: 178.35, change: 0.68 },
  META: { price: 505.6, change: 1.44 },
};

const DEMO_THEMES: ResearchTheme[] = [
  {
    id: "memory",
    name: "Memory Theme",
    symbols: ["MU", "DRAM", "SNDK", "SPCX"],
    starred: true,
    updated: "2h ago",
    summary:
      "Demand remains strong for HBM and enterprise storage. Watching pricing trends and inventory digestion in Q2.",
    bullets: [
      "Micron guiding higher on data center demand",
      "NAND pricing stabilized in May",
      "HBM supply still constrained",
    ],
  },
  {
    id: "ai-infra",
    name: "AI Infrastructure",
    symbols: ["MRVL", "NBIS", "AAOI"],
    starred: false,
    updated: "1d ago",
    summary:
      "Custom silicon and optical interconnect are the picks-and-shovels of the AI buildout. Tracking hyperscaler capex.",
    bullets: [
      "Marvell custom ASIC ramp accelerating",
      "Optical DSP demand outpacing supply",
      "Neocloud capacity fully committed",
    ],
  },
  {
    id: "cloud",
    name: "Cloud Expansion",
    symbols: ["NBIS", "QQQM"],
    starred: false,
    updated: "3d ago",
    summary:
      "GPU-as-a-service capacity is selling out ahead of delivery. Margins depend on utilization and power access.",
    bullets: ["Nebius signing multi-year contracts", "Power availability the key bottleneck"],
  },
  {
    id: "optics",
    name: "Optics & Photonics",
    symbols: ["LITE", "COHR"],
    starred: false,
    updated: "5d ago",
    summary:
      "800G/1.6T transceiver cycle is inflecting. Watching indium phosphide capacity and datacom mix shift.",
    bullets: ["1.6T qualification underway", "Datacom mix lifting gross margin"],
  },
];

// Deterministic mini-trend sparkline points for a symbol (seeded by ticker so it
// stays stable across renders). Drifts up or down to match the day's change sign.
function sparkPoints(seed: string, up: boolean): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h ^ seed.charCodeAt(i), 16777619)) >>> 0;
  }
  const rand = () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 0xffffffff;
  };
  const n = 18;
  const width = 100;
  let y = 14 + (rand() - 0.5) * 6;
  const points: string[] = [];
  for (let i = 0; i < n; i++) {
    y += (rand() - 0.5) * 6 + (up ? -0.4 : 0.4);
    y = Math.max(4, Math.min(24, y));
    points.push(`${((i / (n - 1)) * width).toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

// Build the Research Notes theme list from real tags + items; fall back to the
// demo set when there is nothing meaningful to show.
function deriveThemes(items: WatchlistItem[], tags: WatchlistTag[]): ResearchTheme[] {
  const derived = tags
    .map((tag) => {
      const members = items.filter((item) =>
        item.tags.some((name) => name.toLocaleLowerCase() === tag.name.toLocaleLowerCase()),
      );
      const notes = members.map((member) => member.notes?.trim()).filter((note): note is string => Boolean(note));
      return {
        id: `tag-${tag.id}`,
        name: tag.name,
        symbols: members.map((member) => member.symbol),
        starred: false,
        updated: "recently",
        summary:
          notes[0] ??
          `Tracking ${members.length} ${members.length === 1 ? "symbol" : "symbols"} under the ${tag.name} theme.`,
        bullets: notes.slice(0, 3),
      };
    })
    .filter((theme) => theme.symbols.length > 0)
    .sort((a, b) => b.symbols.length - a.symbols.length);
  return derived.length > 0 ? derived : DEMO_THEMES;
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
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  // True when the backend was unreachable and we rendered the demo dataset.
  const [isDemo, setIsDemo] = useState(false);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [manageSubscriptionOpen, setManageSubscriptionOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  // Themed tag-dot tooltip. Rendered fixed at the page level (with viewport
  // coordinates captured on hover) so it escapes the watchlist panel's
  // overflow:hidden clip instead of using an absolutely-positioned child.
  const [tagTip, setTagTip] = useState<{ text: string; left: number; top: number } | null>(null);
  // ---- Explicit management surfaces --------------------------------------------
  // Three separated modes: view · edit · add.
  // TAGS — inline "Edit themes" mode (delete/rename/reorder) + a lightweight
  // "New tag" popover (name + colour + preview).
  const [themesEditMode, setThemesEditMode] = useState(false);
  const [renamingTagId, setRenamingTagId] = useState<number | null>(null);
  const [renamingTagValue, setRenamingTagValue] = useState("");
  const [dragTagId, setDragTagId] = useState<number | null>(null);
  const [newTagPopoverOpen, setNewTagPopoverOpen] = useState(false);
  const [addTagName, setAddTagName] = useState("");
  const [addTagColor, setAddTagColor] = useState<string>(TAG_COLORS[0]);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  // SYMBOLS — Stage 1: a quick-add popover (search + optional quick tags).
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTags, setQuickAddTags] = useState<string[]>([]);
  // SYMBOLS — Stage 2: a right-side drawer (structured add / edit).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"add" | "edit">("add");
  const [drawerResult, setDrawerResult] = useState<SymbolSearchResult | null>(null);
  const [drawerItem, setDrawerItem] = useState<WatchlistItem | null>(null);
  const [drawerTags, setDrawerTags] = useState<string[]>([]);
  const [drawerTagQuery, setDrawerTagQuery] = useState("");
  const [createNewList, setCreateNewList] = useState(false);
  const [newListName, setNewListName] = useState("");
  // Hover-revealed edit control per card.
  const [hoverCard, setHoverCard] = useState<number | null>(null);
  // Long-press (1.5s) on any tag/ticker is a secondary way to enter Edit themes.
  const longPressRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  function beginLongPress(action: () => void) {
    cancelLongPress();
    longPressFiredRef.current = false;
    longPressRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      action();
    }, 1500);
  }
  function cancelLongPress() {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }
  // Robust press-and-hold for a draggable <a> card: capture the pointer so a
  // little cursor drift can't fire pointerleave and cancel the timer, and only
  // cancel on a real move (scroll/drag) beyond a small threshold.
  function startCardLongPress(event: ReactPointerEvent) {
    longPressStartRef.current = { x: event.clientX, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* not all pointers support capture */
    }
    beginLongPress(enterThemesEditFromLongPress);
  }
  function moveCardLongPress(event: ReactPointerEvent) {
    const start = longPressStartRef.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
      cancelLongPress();
    }
  }
  // Enter Edit themes mode and bring the themes row into view (used from the
  // 1.5s long-press on a tag or a ticker card).
  function enterThemesEditFromLongPress() {
    setThemesEditMode(true);
    setRenamingTagId(null);
    setNewTagPopoverOpen(false);
  }

  async function loadWatchlist() {
    setIsLoading(true);
    setError(null);
    try {
      const [nextItems, nextTags] = await Promise.all([api.watchlist(), api.watchlistTags()]);
      setItems(nextItems);
      setTags(recolorTags(nextTags));
    } catch (requestError: unknown) {
      // Local preview with no backend: fall back to the demo dataset instead of
      // an error so the page still renders. (See DEMO_* above.)
      console.warn("Watchlist API unavailable, using demo data:", requestError);
      setIsDemo(true);
      setItems(DEMO_ITEMS);
      setTags(recolorTags(DEMO_TAGS));
      // Seed name + exchange so cards render fully without the /symbols endpoint,
      // and mark them requested so the lazy meta effect doesn't overwrite with null.
      Object.keys(DEMO_META).forEach((symbol) => symbolMetaRequestedRef.current.add(symbol));
      setSymbolMeta((current) => ({ ...current, ...DEMO_META }));
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
      // Local preview fallback (see loadWatchlist).
      setSubscriptionPlan(DEMO_PLAN);
      const map: Record<string, MarketQuote> = {};
      for (const quote of DEMO_QUOTES) {
        map[quote.symbol.toUpperCase()] = quote;
      }
      setQuotes(map);
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

  // Close the sort dropdown on any outside click.
  useEffect(() => {
    if (!sortMenuOpen) {
      return;
    }
    function handlePointerDown(event: globalThis.MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target || !target.closest(".sort-dropdown")) {
        setSortMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [sortMenuOpen]);

  // Close the header "···" menu and the lightweight popovers on outside click.
  useEffect(() => {
    if (!moreMenuOpen && !quickAddOpen && !newTagPopoverOpen) {
      return;
    }
    function handlePointerDown(event: globalThis.MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (!target.closest(".watchlist-more")) {
        setMoreMenuOpen(false);
      }
      if (!target.closest(".add-ticker-wrap")) {
        setQuickAddOpen(false);
      }
      if (!target.closest(".new-tag-wrap")) {
        setNewTagPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [moreMenuOpen, quickAddOpen, newTagPopoverOpen]);

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
    if (!quickAddOpen) {
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

    if (isDemo) {
      const q = query.toLocaleLowerCase();
      setSymbolResults(
        DEMO_SEARCH.filter(
          (r) => r.symbol.toLocaleLowerCase().includes(q) || (r.name ?? "").toLocaleLowerCase().includes(q),
        ),
      );
      setSymbolSearchOpen(true);
      setIsSymbolSearching(false);
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
  }, [form.symbol, quickAddOpen, isDemo]);

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
    if (isDemo) {
      const maxId = (items ?? []).reduce((m, it) => Math.max(m, it.id), 0);
      const newItem: WatchlistItem = {
        id: maxId + 1,
        symbol,
        display_name: form.displayName.trim() || null,
        notes: form.notes.trim() || null,
        realtime_enabled: false,
        tags: parsedTags,
        has_position: false,
        latest_report_date: null,
        position_quantity: null,
        current_price: null,
        market_value: null,
        unrealized_pnl: null,
        updated_at: new Date().toISOString(),
      };
      setItems((current) => [...(current ?? []), newItem]);
      resetTickerForm();
      setQuickAddOpen(false);
      setToast({ message: `Added ${symbol} to your watchlist.`, tone: "success" });
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
      setQuickAddOpen(false);
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

  // ----- Inline tag management (demo-aware) -----------------------------------
  // In demo mode the API is unreachable, so these mutate local state optimistically
  // so the interaction still works in local preview. On a real backend they hit the
  // API and reload.
  function openNewTagPopover() {
    setAddTagName("");
    // Auto-assign a distinct colour (no manual picker) — least-used in the palette.
    setAddTagColor(pickTagColor(tags));
    setNewTagPopoverOpen(true);
  }

  // Create a single named tag with a chosen colour (from the "New tag" popover).
  async function addNewTag() {
    const name = addTagName.trim();
    if (!name) {
      return;
    }
    if (tags.some((t) => t.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setToast({ message: `"${name}" already exists.`, tone: "info" });
      return;
    }
    if (isDemo) {
      const maxId = tags.reduce((m, t) => Math.max(m, t.id), 0);
      setTags((current) => [...current, { id: maxId + 1, name, count: 0, color: addTagColor }]);
      setNewTagPopoverOpen(false);
      setToast({ message: `Added ${name}.`, tone: "success" });
      return;
    }
    setIsSaving(true);
    try {
      const nextTags = await api.createWatchlistTags([name]);
      setTags(nextTags);
      setNewTagPopoverOpen(false);
      await loadWatchlist();
      setToast({ message: `Added ${name}.`, tone: "success" });
    } catch (requestError: unknown) {
      setToast({ message: requestError instanceof Error ? requestError.message : "Couldn't add tag.", tone: "error" });
    } finally {
      setIsSaving(false);
    }
  }

  // Drag-to-reorder within the Edit themes panel (local only — there is no order
  // field on the API, so this reorders the in-memory list for the session).
  function reorderTags(fromId: number, toId: number) {
    if (fromId === toId) {
      return;
    }
    setTags((current) => {
      const next = [...current];
      const from = next.findIndex((t) => t.id === fromId);
      const to = next.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0) {
        return current;
      }
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function renameTagInline(tag: WatchlistTag) {
    const name = renamingTagValue.trim();
    setRenamingTagId(null);
    if (!name || name.toLocaleLowerCase() === tag.name.toLocaleLowerCase()) {
      return;
    }
    if (isDemo) {
      setTags((current) => current.map((t) => (t.id === tag.id ? { ...t, name } : t)));
      setItems((current) =>
        (current ?? []).map((item) => ({
          ...item,
          tags: item.tags.map((t) => (t.toLocaleLowerCase() === tag.name.toLocaleLowerCase() ? name : t)),
        })),
      );
      return;
    }
    setIsSaving(true);
    try {
      await api.updateWatchlistTag(tag.id, { name });
      await loadWatchlist();
    } catch (requestError: unknown) {
      setToast({ message: requestError instanceof Error ? requestError.message : "Couldn't rename tag.", tone: "error" });
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteTagInline(tag: WatchlistTag) {
    if (isDemo) {
      setTags((current) => current.filter((t) => t.id !== tag.id));
      setItems((current) =>
        (current ?? []).map((item) => ({
          ...item,
          tags: item.tags.filter((t) => t.toLocaleLowerCase() !== tag.name.toLocaleLowerCase()),
        })),
      );
      setSelectedTags((current) => current.filter((t) => t.toLocaleLowerCase() !== tag.name.toLocaleLowerCase()));
      setToast({ message: `Deleted ${tag.name}.`, tone: "success" });
      return;
    }
    setIsSaving(true);
    try {
      await api.deleteWatchlistTag(tag.id);
      setSelectedTags((current) => current.filter((t) => t.toLocaleLowerCase() !== tag.name.toLocaleLowerCase()));
      await loadWatchlist();
      setToast({ message: `Deleted ${tag.name}.`, tone: "success" });
    } catch (requestError: unknown) {
      setToast({ message: requestError instanceof Error ? requestError.message : "Couldn't delete tag.", tone: "error" });
    } finally {
      setIsSaving(false);
    }
  }

  // ----- 3-step Add symbol flow ----------------------------------------------
  // ----- Stage 1: quick-add popover ------------------------------------------
  function openQuickAdd() {
    setForm(EMPTY_TICKER_FORM);
    setQuickAddTags([]);
    setSymbolResults([]);
    setSymbolSearchError(null);
    setQuickAddOpen(true);
  }

  function toggleQuickTag(name: string) {
    setQuickAddTags((current) =>
      current.some((t) => t.toLocaleLowerCase() === name.toLocaleLowerCase())
        ? current.filter((t) => t.toLocaleLowerCase() !== name.toLocaleLowerCase())
        : [...current, name],
    );
  }

  // Choosing a suggestion promotes the flow into the structured drawer (stage 2).
  function chooseSymbolForDrawer(result: SymbolSearchResult) {
    if (watchlistSymbolSet.has(result.symbol.toUpperCase())) {
      setToast({ message: `${result.symbol} is already in your watchlist.`, tone: "info" });
      return;
    }
    setQuickAddOpen(false);
    setDrawerMode("add");
    setDrawerResult(result);
    setDrawerItem(null);
    setDrawerTags(quickAddTags);
    setDrawerTagQuery("");
    setCreateNewList(false);
    setNewListName("");
    setDrawerOpen(true);
  }

  // ----- Stage 2 / Edit: the structured drawer -------------------------------
  function openEditDrawer(item: WatchlistItem) {
    setDrawerMode("edit");
    setDrawerItem(item);
    setDrawerResult(null);
    setDrawerTags(item.tags);
    setDrawerTagQuery("");
    setCreateNewList(false);
    setNewListName("");
    setDrawerOpen(true);
  }

  function toggleDrawerTag(name: string) {
    setDrawerTags((current) =>
      current.some((t) => t.toLocaleLowerCase() === name.toLocaleLowerCase())
        ? current.filter((t) => t.toLocaleLowerCase() !== name.toLocaleLowerCase())
        : [...current, name],
    );
  }

  async function createTagForDrawer() {
    const name = drawerTagQuery.trim();
    if (!name) {
      return;
    }
    if (!tags.some((t) => t.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      if (isDemo) {
        const maxId = tags.reduce((m, t) => Math.max(m, t.id), 0);
        setTags((current) => [...current, { id: maxId + 1, name, count: 0, color: pickTagColor(current) }]);
      } else {
        try {
          setTags(await api.createWatchlistTags([name]));
        } catch {
          /* still select locally */
        }
      }
    }
    if (!drawerTags.some((t) => t.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setDrawerTags((current) => [...current, name]);
    }
    setDrawerTagQuery("");
  }

  async function confirmDrawer() {
    if (drawerMode === "edit" && drawerItem) {
      const symbol = drawerItem.symbol;
      if (isDemo) {
        setItems((current) =>
          (current ?? []).map((it) => (it.id === drawerItem.id ? { ...it, tags: drawerTags } : it)),
        );
        setDrawerOpen(false);
        setToast({ message: `Updated ${symbol}.`, tone: "success" });
        return;
      }
      setIsSaving(true);
      try {
        await api.updateWatchlistTicker(symbol, { tags: drawerTags });
        await loadWatchlist();
        setDrawerOpen(false);
        setToast({ message: `Updated ${symbol}.`, tone: "success" });
      } catch (requestError: unknown) {
        setToast({ message: requestError instanceof Error ? requestError.message : `Couldn't update ${symbol}.`, tone: "error" });
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const chosen = drawerResult;
    if (!chosen) {
      return;
    }
    const symbol = chosen.symbol.toUpperCase();
    if ((items ?? []).some((entry) => entry.symbol.toUpperCase() === symbol)) {
      setToast({ message: `${symbol} is already in your watchlist.`, tone: "error" });
      return;
    }
    if (isDemo) {
      const maxId = (items ?? []).reduce((m, it) => Math.max(m, it.id), 0);
      setItems((current) => [
        ...(current ?? []),
        {
          id: maxId + 1,
          symbol,
          display_name: chosen.name,
          notes: null,
          realtime_enabled: false,
          tags: drawerTags,
          has_position: false,
          latest_report_date: null,
          position_quantity: null,
          current_price: null,
          market_value: null,
          unrealized_pnl: null,
          updated_at: new Date().toISOString(),
        },
      ]);
      setDrawerOpen(false);
      setToast({ message: `Added ${symbol} to your watchlist.`, tone: "success" });
      return;
    }
    setIsSaving(true);
    try {
      await api.createWatchlistTicker({ symbol, tags: drawerTags, display_name: chosen.name, notes: null });
      setVisibleCount(WATCHLIST_PAGE_SIZE);
      await loadWatchlist();
      setDrawerOpen(false);
      setToast({ message: `Added ${symbol} to your watchlist.`, tone: "success" });
    } catch (requestError: unknown) {
      setToast({ message: requestError instanceof Error ? requestError.message : `Couldn't add ${symbol}.`, tone: "error" });
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
    if (isDemo) {
      setItems((current) => (current ?? []).filter((item) => item.symbol.toUpperCase() !== symbol.toUpperCase()));
      setToast({ message: `Removed ${symbol}.`, tone: "success" });
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

  const subscribedSet = useMemo(
    () => new Set((subscriptionPlan?.symbols ?? []).map((symbol) => symbol.toUpperCase())),
    [subscriptionPlan],
  );
  const capReached = subscriptionPlan ? subscriptionPlan.subscribed_count >= subscriptionPlan.max_symbols : false;

  const rows: WatchlistRow[] = useMemo(() => {
    const selectedTagKeys = selectedTags.map((tag) => tag.toLocaleLowerCase());
    const searchTerm = debouncedSearch.toLocaleLowerCase();

    // Inline price/change (the priceFor/changePctFor helpers below aren't in
    // scope yet); used only for the Price / Change sort modes.
    const priceOf = (item: WatchlistItem): number | null => {
      const quote = quotes[item.symbol.toUpperCase()];
      if (subscribedSet.has(item.symbol.toUpperCase()) && quote && decimalNumber(quote.last_price ?? null) !== null) {
        return decimalNumber(quote.last_price);
      }
      return decimalNumber(item.current_price);
    };
    const changeOf = (item: WatchlistItem): number | null => {
      if (!subscribedSet.has(item.symbol.toUpperCase())) {
        return null;
      }
      const quote = quotes[item.symbol.toUpperCase()];
      const last = decimalNumber(quote?.last_price ?? null);
      const reference = decimalNumber(quote?.previous_close ?? null);
      if (last === null || reference === null || reference === 0) {
        return null;
      }
      return ((last - reference) / reference) * 100;
    };

    const filtered = (items ?? []).filter((item) => {
      const matchesHolding = !holdingOnly || item.has_position;
      const itemTagKeys = item.tags.map((tag) => tag.toLocaleLowerCase());
      const matchesTags =
        selectedTagKeys.length === 0 || selectedTagKeys.every((tag) => itemTagKeys.includes(tag));
      const matchesSearch = !searchTerm || item.symbol.toLocaleLowerCase().includes(searchTerm);

      return matchesHolding && matchesTags && matchesSearch;
    });

    const comparator: (a: WatchlistItem, b: WatchlistItem) => number =
      sortMode === "symbol"
        ? (a, b) => a.symbol.localeCompare(b.symbol)
        : sortMode === "price"
          ? (a, b) => (priceOf(b) ?? -Infinity) - (priceOf(a) ?? -Infinity) || a.symbol.localeCompare(b.symbol)
          : sortMode === "change"
            ? (a, b) => (changeOf(b) ?? -Infinity) - (changeOf(a) ?? -Infinity) || a.symbol.localeCompare(b.symbol)
            : // "recent": holdings first, then manual, then unsubscribed; A→Z within each.
              (a, b) => {
                const rank = (item: WatchlistItem) => (item.has_position ? 0 : item.realtime_enabled ? 1 : 2);
                return rank(a) - rank(b) || a.symbol.localeCompare(b.symbol);
              };

    return filtered
      .sort(comparator)
      .map((item) => ({
        ...item,
        status: item.has_position ? "Holding" : "No Position",
        actions: item.symbol,
        tagList: item.tags.join(", "),
      }));
  }, [debouncedSearch, holdingOnly, items, selectedTags, sortMode, quotes, subscribedSet]);

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

  // Market Pulse: derive top gainers / losers / unusual activity from the live
  // quotes. Unusual activity is a lightweight heuristic (biggest movers not
  // already surfaced above, tagged as volume or news) since we have no feed.
  const marketPulse = useMemo(() => {
    const movers = (items ?? [])
      .map((item) => ({ symbol: item.symbol, change: changePctFor(item) }))
      .filter((entry): entry is { symbol: string; change: number } => entry.change !== null);
    const gainers = movers
      .filter((entry) => entry.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, 3);
    const losers = movers
      .filter((entry) => entry.change < 0)
      .sort((a, b) => a.change - b.change)
      .slice(0, 3);
    const surfaced = new Set([...gainers, ...losers].map((entry) => entry.symbol));
    const unusual = (items ?? [])
      .filter((item) => !surfaced.has(item.symbol))
      .slice(0, 3)
      .map((item, index) => ({ symbol: item.symbol, kind: index === 2 ? "news" : "vol" as "news" | "vol" }));
    return { gainers, losers, unusual };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, quotes, subscribedSet]);

  const themes = useMemo(
    () => (isDemo ? DEMO_THEMES : deriveThemes(items ?? [], tags)),
    [isDemo, items, tags],
  );
  const activeTheme = useMemo(
    () => themes.find((theme) => theme.id === activeThemeId) ?? themes[0] ?? null,
    [themes, activeThemeId],
  );

  const autoCount = subscriptionPlan?.holdings_count ?? 0;
  const manualCount = subscriptionPlan
    ? Math.max(subscriptionPlan.subscribed_count - subscriptionPlan.holdings_count, 0)
    : 0;

  // Stage-1 quick-add popover, anchored to the in-grid "Add symbol" card.
  const quickAddPopover = quickAddOpen ? (
    <div className="quick-add-popover" role="dialog" aria-label="Quick add symbol">
      <div className="wl-search-wrap">
        <svg className="wl-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          autoFocus
          className="wl-input wl-search-input"
          placeholder="Search symbol — e.g. NVDA"
          value={form.symbol}
          onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))}
        />
      </div>
      <div className="quick-add-list">
        {isSymbolSearching ? <div className="symbol-search-status">Searching…</div> : null}
        {symbolSearchError ? <div className="symbol-search-status symbol-search-error">{symbolSearchError}</div> : null}
        {!form.symbol.trim() ? <div className="symbol-search-status">Type a ticker or company name.</div> : null}
        {form.symbol.trim() && !isSymbolSearching && symbolResults.length === 0 ? (
          <div className="symbol-search-status">No matching symbols</div>
        ) : null}
        {symbolResults.slice(0, 6).map((result) => {
          const alreadyAdded = watchlistSymbolSet.has(result.symbol.toUpperCase());
          const quote = DEMO_PRICE[result.symbol.toUpperCase()];
          return (
            <button
              className={`wl-sug${alreadyAdded ? " is-added" : ""}`}
              disabled={alreadyAdded}
              key={`${result.symbol}-${result.exchange ?? "x"}`}
              onClick={() => chooseSymbolForDrawer(result)}
              type="button"
            >
              <span className="wl-sug-logo">{result.symbol.slice(0, 2)}</span>
              <span className="wl-sug-main">
                <span className="wl-sug-top">
                  <strong>{result.symbol}</strong>
                  <span className="wl-sug-name">{result.name ?? "Unnamed"}</span>
                  {alreadyAdded ? <span className="wl-sug-added">Added</span> : null}
                </span>
                <span className="wl-sug-exch">{result.exchange ?? "—"}</span>
              </span>
              {quote ? <span className="wl-sug-price">{`$${quote.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span> : null}
            </button>
          );
        })}
      </div>
      {tags.length > 0 ? (
        <div className="quick-add-tags-block">
          <span className="quick-add-tags-label">Quick tags (optional)</span>
          <div className="quick-add-tags">
            {tags.slice(0, 8).map((tag) => {
              const on = quickAddTags.some((t) => t.toLocaleLowerCase() === tag.name.toLocaleLowerCase());
              return (
                <button
                  className={`wl-tag-chip${on ? " is-on" : ""}`}
                  key={tag.id}
                  onClick={() => toggleQuickTag(tag.name)}
                  type="button"
                >
                  {on ? <span className="wl-tag-check">✓</span> : null}
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

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
      <div className="page-header watchlist-hero-header">
        <div>
          <p className="eyebrow">Personal research</p>
          <h1>Watchlist</h1>
          <p className="page-description">Track what matters. Stay ahead of the market.</p>
        </div>
        <div className="watchlist-hero-actions">
          <button
            className={`secondary-button hero-edit-btn${themesEditMode ? " is-active" : ""}`}
            onClick={() => {
              setThemesEditMode((on) => !on);
              setRenamingTagId(null);
              setNewTagPopoverOpen(false);
            }}
            type="button"
          >
            {themesEditMode ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Done
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                Edit themes
              </>
            )}
          </button>
          <div className="watchlist-more">
            <button
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              className="hero-more-btn"
              onClick={() => setMoreMenuOpen((open) => !open)}
              type="button"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
            {moreMenuOpen ? (
              <div className="watchlist-more-menu" role="menu">
                <button
                  className="watchlist-more-item"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    setThemesEditMode(true);
                    document.querySelector(".research-themes")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  role="menuitem"
                  type="button"
                >
                  Edit research themes
                </button>
                <button
                  className="watchlist-more-item"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    setManageSubscriptionOpen(true);
                  }}
                  role="menuitem"
                  type="button"
                >
                  Manage subscription
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="watchlist-pulse-row">
        <section className="panel pulse-card" aria-label="Market Pulse">
          <div className="pulse-card-head">
            <h2 className="pulse-card-title">Market Pulse</h2>
            <p>A quick read on your watchlist.</p>
          </div>
          <div className="pulse-columns">
            <div className="pulse-col">
              <p className="pulse-col-label">Top Gainers</p>
              {marketPulse.gainers.length > 0 ? (
                marketPulse.gainers.map((entry) => (
                  <div className="pulse-row-item" key={`g-${entry.symbol}`}>
                    <span className="pulse-symbol">{entry.symbol}</span>
                    <span className="pulse-change is-up">{`+${entry.change.toFixed(2)}%`}</span>
                  </div>
                ))
              ) : (
                <p className="pulse-empty">No movers yet</p>
              )}
            </div>
            <div className="pulse-col">
              <p className="pulse-col-label">Top Losers</p>
              {marketPulse.losers.length > 0 ? (
                marketPulse.losers.map((entry) => (
                  <div className="pulse-row-item" key={`l-${entry.symbol}`}>
                    <span className="pulse-symbol">{entry.symbol}</span>
                    <span className="pulse-change is-down">{`${entry.change.toFixed(2)}%`}</span>
                  </div>
                ))
              ) : (
                <p className="pulse-empty">No movers yet</p>
              )}
            </div>
            <div className="pulse-col">
              <p className="pulse-col-label">Unusual Activity</p>
              {marketPulse.unusual.length > 0 ? (
                marketPulse.unusual.map((entry) => (
                  <div className="pulse-row-item" key={`u-${entry.symbol}`}>
                    <span className="pulse-symbol">{entry.symbol}</span>
                    {entry.kind === "news" ? (
                      <span className="pulse-tag is-news">News</span>
                    ) : (
                      <span className="pulse-tag is-vol">↑ Vol</span>
                    )}
                  </div>
                ))
              ) : (
                <p className="pulse-empty">Nothing unusual</p>
              )}
            </div>
          </div>
          <div className="pulse-foot">
            <span className="pulse-live-dot" aria-hidden="true" />
            Updated just now
          </div>
        </section>

        <section className="panel realtime-card" aria-label="Realtime Market Data">
          <div className="realtime-card-head">
            <span className="realtime-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="14" cy="18" r="2.6" fill="currentColor" />
                <path d="M9.5 13.5a6.4 6.4 0 0 1 9 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" fill="none" />
                <path d="M6 10a11 11 0 0 1 16 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" fill="none" />
              </svg>
            </span>
            <div>
              <h2 className="realtime-title">Realtime Market Data</h2>
              <p className="realtime-status">Active subscription</p>
            </div>
          </div>
          <p className="realtime-count">
            <strong>{subscriptionPlan?.subscribed_count ?? 0}</strong> / {subscriptionPlan?.max_symbols ?? 30}{" "}
            <span>symbols</span>
          </p>
          <div className="realtime-bar" role="presentation">
            <span
              className="realtime-bar-auto"
              style={{ width: `${Math.min((autoCount / Math.max(subscriptionPlan?.max_symbols ?? 30, 1)) * 100, 100)}%` }}
            />
            <span
              className="realtime-bar-manual"
              style={{ width: `${Math.min((manualCount / Math.max(subscriptionPlan?.max_symbols ?? 30, 1)) * 100, 100)}%` }}
            />
          </div>
          <p className="realtime-detail">
            Includes {autoCount} auto-subscribed from holdings
            <br />
            {manualCount} manually added from watchlist
          </p>
          <button className="realtime-manage" onClick={() => setManageSubscriptionOpen(true)} type="button">
            Manage subscription
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </section>
      </div>

      <section className="research-themes">
        <div className="research-themes-head">
          <h2 className="section-title">Research Themes</h2>
          <div className="research-themes-controls">
            <label className="search-field positions-search-field research-search">
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
            <button
              className={`themes-filter-toggle${holdingOnly ? " is-active" : ""}`}
              onClick={toggleHoldingFilter}
              title="Show holdings only"
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16" />
                <path d="M7 12h10" />
                <path d="M10 18h4" />
              </svg>
            </button>
          </div>
        </div>
        <div className={`tag-filter research-tag-filter${themesEditMode ? " is-editing" : ""}`} aria-label="Watchlist tag filter">
          {!themesEditMode ? (
            <>
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
                className={`tag-filter-button holding-filter-button${holdingOnly ? " tag-filter-button-active holding-filter-button-active" : ""}`}
                onClick={toggleHoldingFilter}
                type="button"
              >
                Holdings <span>{holdingCount}</span>
              </button>
              {(tagFilterExpanded ? tags : tags.slice(0, TAG_FILTER_COLLAPSED_COUNT)).map((tag) => {
                const selected = selectedTags.some(
                  (selectedTag) => selectedTag.toLocaleLowerCase() === tag.name.toLocaleLowerCase(),
                );
                return (
                  <button
                    aria-pressed={selected}
                    className={`tag-filter-button${selected ? " tag-filter-button-active" : ""}`}
                    key={tag.name}
                    onPointerDown={() => beginLongPress(enterThemesEditFromLongPress)}
                    onPointerUp={cancelLongPress}
                    onPointerLeave={cancelLongPress}
                    onClick={() => {
                      if (longPressFiredRef.current) {
                        longPressFiredRef.current = false;
                        return;
                      }
                      toggleFilterTag(tag.name);
                    }}
                    style={{ backgroundColor: selected ? tag.color ?? DEFAULT_TAG_COLOR : undefined }}
                    type="button"
                  >
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
            </>
          ) : (
            <>
              {tags.map((tag) =>
                renamingTagId === tag.id ? (
                  <input
                    key={tag.id}
                    autoFocus
                    className="edit-theme-rename"
                    value={renamingTagValue}
                    onChange={(event) => setRenamingTagValue(event.target.value)}
                    onBlur={() => renameTagInline(tag)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        renameTagInline(tag);
                      } else if (event.key === "Escape") {
                        setRenamingTagId(null);
                      }
                    }}
                  />
                ) : (
                  <span
                    key={tag.id}
                    className={`edit-theme-chip${dragTagId === tag.id ? " is-dragging" : ""}`}
                    draggable
                    onDragStart={() => setDragTagId(tag.id)}
                    onDragEnd={() => setDragTagId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (dragTagId !== null) {
                        reorderTags(dragTagId, tag.id);
                      }
                      setDragTagId(null);
                    }}
                  >
                    <button
                      aria-label={`Delete ${tag.name}`}
                      className="edit-theme-del"
                      onClick={() => deleteTagInline(tag)}
                      type="button"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                    <span className="edit-theme-handle" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                    </span>
                    <button
                      className="edit-theme-body"
                      onClick={() => {
                        // Swallow the release click that follows a long-press
                        // (which just entered this edit mode), so it doesn't
                        // immediately open rename.
                        if (longPressFiredRef.current) {
                          longPressFiredRef.current = false;
                          return;
                        }
                        setRenamingTagId(tag.id);
                        setRenamingTagValue(tag.name);
                      }}
                      type="button"
                    >
                      <span className="edit-theme-dot" style={{ background: tag.color ?? DEFAULT_TAG_COLOR }} />
                      {tag.name}
                    </button>
                  </span>
                ),
              )}
            </>
          )}
          <span className="new-tag-wrap">
            <button className="tag-filter-button new-tag-button" onClick={openNewTagPopover} type="button">
              <span className="new-tag-plus" aria-hidden="true">+</span> New tag
            </button>
            {newTagPopoverOpen ? (
              <div className="new-tag-popover" role="dialog" aria-label="Create tag">
                <p className="new-tag-popover-label">New tag</p>
                <input
                  autoFocus
                  className="new-tag-popover-input"
                  maxLength={20}
                  placeholder="Tag name"
                  value={addTagName}
                  onChange={(event) => setAddTagName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && addTagName.trim()) {
                      event.preventDefault();
                      addNewTag();
                    } else if (event.key === "Escape") {
                      setNewTagPopoverOpen(false);
                    }
                  }}
                />
                <div className="new-tag-preview-row">
                  <span className="new-tag-preview-label">Preview</span>
                  <span className="tag-preview-chip">
                    <span className="edit-theme-dot" style={{ background: addTagColor }} />
                    {addTagName.trim() || "New tag"}
                  </span>
                </div>
                <div className="new-tag-popover-actions">
                  <button className="new-tag-cancel" onClick={() => setNewTagPopoverOpen(false)} type="button">
                    Cancel
                  </button>
                  <button className="new-tag-popover-add" disabled={!addTagName.trim() || isSaving} onClick={addNewTag} type="button">
                    Add tag
                  </button>
                </div>
              </div>
            ) : null}
          </span>
        </div>
        {filterNotice ? <p className="filter-notice research-filter-notice">{filterNotice}</p> : null}
        {themesEditMode ? (
          <p className="tag-edit-hint">Click a tag to rename · drag to reorder · ✕ to delete · “Done” when finished.</p>
        ) : null}
      </section>

      <section className="panel watchlist-panel">
        <div className="panel-header positions-panel-header watchlist-tracked-header">
          <div>
            <h2>Tracked Tickers</h2>
            <p>
              {holdingOnly || selectedTags.length > 0
                ? `Filtered by ${[holdingOnly ? "Holding" : null, ...selectedTags].filter(Boolean).join(" + ")}.`
                : "All tickers in your personal watchlist."}
            </p>
          </div>
          <div className="watchlist-list-controls">
            <div className="sort-dropdown">
              <span className="sort-dropdown-label">Sort by</span>
              <button
                aria-expanded={sortMenuOpen}
                aria-haspopup="listbox"
                className="sort-dropdown-trigger"
                onClick={() => setSortMenuOpen((open) => !open)}
                type="button"
              >
                {SORT_LABELS[sortMode]}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {sortMenuOpen ? (
                <div className="sort-dropdown-menu" role="listbox">
                  {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                    <button
                      className={`sort-dropdown-option${sortMode === mode ? " is-active" : ""}`}
                      key={mode}
                      onClick={() => {
                        setSortMode(mode);
                        setSortMenuOpen(false);
                      }}
                      role="option"
                      aria-selected={sortMode === mode}
                      type="button"
                    >
                      {SORT_LABELS[mode]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="view-toggle" role="group" aria-label="View mode">
              <button
                aria-label="Grid view"
                aria-pressed={viewMode === "grid"}
                className={`view-toggle-btn${viewMode === "grid" ? " is-active" : ""}`}
                onClick={() => setViewMode("grid")}
                type="button"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
              </button>
              <button
                aria-label="List view"
                aria-pressed={viewMode === "list"}
                className={`view-toggle-btn${viewMode === "list" ? " is-active" : ""}`}
                onClick={() => setViewMode("list")}
                type="button"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 6h13" />
                  <path d="M8 12h13" />
                  <path d="M8 18h13" />
                  <path d="M3.5 6h.01" />
                  <path d="M3.5 12h.01" />
                  <path d="M3.5 18h.01" />
                </svg>
              </button>
            </div>
          </div>
        </div>
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
              <div className={`ticker-card-grid${viewMode === "list" ? " is-list" : ""}`}>
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
                      draggable={false}
                      onPointerDown={startCardLongPress}
                      onPointerMove={moveCardLongPress}
                      onPointerUp={cancelLongPress}
                      onPointerCancel={cancelLongPress}
                      onClick={(event) => {
                        if (longPressFiredRef.current) {
                          longPressFiredRef.current = false;
                          event.preventDefault();
                          return;
                        }
                        // While Edit themes is active, a card click opens its
                        // edit drawer instead of navigating to details.
                        if (themesEditMode) {
                          event.preventDefault();
                          openEditDrawer(row);
                          return;
                        }
                        guardDetailsNavigation(row, event);
                      }}
                      onMouseEnter={() => setHoverCard(row.id)}
                      onMouseLeave={() => setHoverCard((current) => (current === row.id ? null : current))}
                    >
                      {themesEditMode ? (
                        row.has_position ? (
                          <span className="ticker-card-lock" title="Held positions sync from IBKR and can't be removed." aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="4" y="11" width="16" height="9" rx="2" />
                              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                            </svg>
                          </span>
                        ) : (
                          <span
                            className="ticker-card-del"
                            role="button"
                            tabIndex={0}
                            aria-label={`Remove ${row.symbol}`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              deleteTicker(row.symbol);
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
                              <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                          </span>
                        )
                      ) : (
                        <span
                          className="ticker-card-edit"
                          role="button"
                          tabIndex={0}
                          aria-label={`Edit ${row.symbol}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openEditDrawer(row);
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </span>
                      )}
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
                      <div className={`ticker-spark ${change !== null && change < 0 ? "is-down" : "is-up"}`} aria-hidden="true">
                        <svg viewBox="0 0 100 28" preserveAspectRatio="none">
                          <polyline points={sparkPoints(row.symbol, change === null ? true : change >= 0)} fill="none" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
                        </svg>
                      </div>
                      <div className="ticker-card-foot">
                        <span className="ticker-card-price-wrap">
                          {price === null ? (
                            <span className="ticker-card-price is-muted">—</span>
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
                      {row.tags.length > 0 ? (
                        <div className="ticker-card-tags" aria-label="Tags">
                          {row.tags.slice(0, 3).map((tag) => (
                            <span className="ticker-card-tagpill" key={tag}>
                              <span className="ticker-card-tagdot" style={{ backgroundColor: tagColor(tag, tags) }} />
                              {tag}
                            </span>
                          ))}
                          {row.tags.length > 3 ? <span className="ticker-card-tagmore">+{row.tags.length - 3}</span> : null}
                        </div>
                      ) : null}
                    </Link>
                  );
                })}
                {!hasMoreRows && viewMode === "grid" ? (
                  <>
                    <div className="add-ticker-wrap">
                      <button
                        className={`ticker-card ticker-card-add${quickAddOpen ? " is-open" : ""}`}
                        onClick={() => (quickAddOpen ? setQuickAddOpen(false) : openQuickAdd())}
                        type="button"
                      >
                        <span className="ticker-card-add-icon" aria-hidden="true">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 5v14" />
                            <path d="M5 12h14" />
                          </svg>
                        </span>
                        Add symbol
                      </button>
                      {quickAddPopover}
                    </div>
                    {Array.from({ length: Math.max(0, 4 - (visibleRows.length % 5 === 0 ? 4 : (visibleRows.length + 1) % 5)) }).map(
                      (_, index) => (
                        <div className="ticker-card ticker-card-ghost" key={`ghost-${index}`} aria-hidden="true">
                          <svg width="46" height="26" viewBox="0 0 60 34" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 24l12-12 10 8 8-12 10 10 8-6" />
                          </svg>
                        </div>
                      ),
                    )}
                  </>
                ) : null}
              </div>
            )}
            {hasMoreRows ? (
              <div className="ticker-card-loadmore">
                <button
                  className="load-more-button"
                  onClick={() => setVisibleCount((current) => current + WATCHLIST_PAGE_SIZE)}
                  type="button"
                >
                  Load more
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                <div className="ticker-card-sentinel" ref={watchlistSentinelRef} aria-hidden="true" />
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="research-notes">
        <div className="research-notes-head">
          <h2 className="section-title">Research Notes</h2>
          <p>Organize your themes and notes.</p>
        </div>
        <div className="research-notes-body">
          <div className="notes-theme-list">
            {themes.map((theme) => {
              const isActive = (activeTheme?.id ?? "") === theme.id;
              return (
                <button
                  className={`notes-theme-item${isActive ? " is-active" : ""}`}
                  key={theme.id}
                  onClick={() => setActiveThemeId(theme.id)}
                  type="button"
                >
                  <span className="notes-theme-name">
                    {theme.name}
                    {theme.starred ? <span className="notes-theme-star" aria-hidden="true">★</span> : null}
                  </span>
                  <span className="notes-theme-count">{theme.symbols.length} symbols</span>
                </button>
              );
            })}
            <button
              className="notes-theme-item notes-theme-new"
              onClick={() => {
                document.querySelector(".research-themes")?.scrollIntoView({ behavior: "smooth", block: "start" });
                openNewTagPopover();
              }}
              type="button"
            >
              <span className="notes-theme-name">
                <span className="notes-theme-plus" aria-hidden="true">+</span> New Note
              </span>
            </button>
          </div>
          {activeTheme ? (
            <div className="notes-detail">
              <div className="notes-detail-head">
                <div>
                  <h3 className="notes-detail-title">{activeTheme.name}</h3>
                  <p className="notes-detail-sub">{activeTheme.symbols.length} symbols tracked</p>
                </div>
                <div className="notes-detail-meta">
                  <span className="notes-detail-updated">Updated {activeTheme.updated}</span>
                  <span className="notes-detail-dots" aria-hidden="true">•••</span>
                </div>
              </div>
              <div className="notes-detail-symbols">
                {activeTheme.symbols.map((symbol) => (
                  <span className="notes-symbol-pill" key={symbol}>
                    {symbol}
                  </span>
                ))}
              </div>
              <div className="notes-detail-divider" aria-hidden="true" />
              <p className="notes-detail-summary">{activeTheme.summary}</p>
              {activeTheme.bullets.length > 0 ? (
                <ul className="notes-detail-bullets">
                  {activeTheme.bullets.map((bullet, index) => (
                    <li key={index}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
              <svg className="notes-detail-star" width="70" height="70" viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M40 14 L46 34 L66 34 L50 46 L56 66 L40 54 L24 66 L30 46 L14 34 L34 34 Z" />
              </svg>
            </div>
          ) : null}
        </div>
      </section>

      <div className="watchlist-tip">
        <span className="watchlist-tip-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 L14 9 L20 9 L15 13 L17 19 L12 15 L7 19 L9 13 L4 9 L10 9 Z" />
          </svg>
        </span>
        <p>
          <strong>Tip:</strong> Use themes to group your ideas and track market narratives.
        </p>
        <button
          className="watchlist-tip-link"
          onClick={() => document.querySelector(".research-themes")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          type="button"
        >
          Learn more
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 17 17 7" />
            <path d="M8 7h9v9" />
          </svg>
        </button>
      </div>

      {/* ---- Structured symbol drawer (add stage 2 + edit) ---- */}
      {drawerOpen
        ? (() => {
            const dSymbol = (drawerMode === "edit" ? drawerItem?.symbol : drawerResult?.symbol) ?? "";
            const upper = dSymbol.toUpperCase();
            const dName =
              drawerMode === "edit"
                ? symbolMeta[upper]?.name ?? drawerItem?.display_name ?? null
                : drawerResult?.name ?? null;
            const dExch = drawerMode === "edit" ? symbolMeta[upper]?.exchange ?? null : drawerResult?.exchange ?? null;
            const dQuote = DEMO_PRICE[upper];
            const editPrice = drawerMode === "edit" && drawerItem ? priceFor(drawerItem) : null;
            const editChange = drawerMode === "edit" && drawerItem ? changePctFor(drawerItem) : null;
            const showPrice = dQuote ? dQuote.price : editPrice !== null ? Number(editPrice) : null;
            const showChange = dQuote ? dQuote.change : editChange;
            return (
              <div className="wl-drawer-overlay" onMouseDown={() => setDrawerOpen(false)} role="presentation">
                <aside
                  className="wl-drawer"
                  onMouseDown={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-label={drawerMode === "edit" ? "Edit symbol" : "Add symbol"}
                >
                  <div className="wl-drawer-head">
                    <h2 className="wl-drawer-title">{drawerMode === "edit" ? "Edit symbol" : "Add to watchlist"}</h2>
                    <button className="wl-close-btn" aria-label="Close" onClick={() => setDrawerOpen(false)} type="button">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                  <div className="wl-drawer-body">
                    <div className="wl-review-symbol">
                      <span className="wl-sug-logo wl-review-logo">{dSymbol.slice(0, 2)}</span>
                      <span className="wl-sug-main">
                        <span className="wl-sug-top">
                          <strong>{dSymbol}</strong>
                          <span className="wl-sug-name">{dName ?? "—"}</span>
                        </span>
                        <span className="wl-sug-exch">{dExch ?? "—"}</span>
                      </span>
                      {showPrice !== null ? (
                        <span className="wl-sug-quote">
                          <span className="wl-sug-price">{`$${showPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
                          {showChange !== null && showChange !== undefined ? (
                            <span className={`wl-sug-change ${showChange >= 0 ? "is-up" : "is-down"}`}>
                              {`${showChange >= 0 ? "+" : ""}${showChange.toFixed(2)}%`}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </div>

                    <div className="wl-field">
                      <span className="wl-field-label">Tags</span>
                      <div className="wl-search-wrap">
                        <svg className="wl-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="11" cy="11" r="7" />
                          <path d="M21 21l-4.3-4.3" />
                        </svg>
                        <input
                          className="wl-input wl-search-input"
                          placeholder="Search or create tag"
                          value={drawerTagQuery}
                          onChange={(event) => setDrawerTagQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && drawerTagQuery.trim()) {
                              event.preventDefault();
                              createTagForDrawer();
                            }
                          }}
                        />
                        {drawerTagQuery.trim() && !tags.some((t) => t.name.toLocaleLowerCase() === drawerTagQuery.trim().toLocaleLowerCase()) ? (
                          <button className="wl-create-tag" onClick={createTagForDrawer} type="button">
                            Create “{drawerTagQuery.trim()}”
                          </button>
                        ) : null}
                      </div>
                      <div className="wl-tag-chips">
                        {tags
                          .filter((tag) => !drawerTagQuery.trim() || tag.name.toLocaleLowerCase().includes(drawerTagQuery.trim().toLocaleLowerCase()))
                          .map((tag) => {
                            const on = drawerTags.some((t) => t.toLocaleLowerCase() === tag.name.toLocaleLowerCase());
                            return (
                              <button
                                className={`wl-tag-chip${on ? " is-on" : ""}`}
                                key={tag.id}
                                onClick={() => toggleDrawerTag(tag.name)}
                                type="button"
                              >
                                {on ? <span className="wl-tag-check">✓</span> : null}
                                {tag.name}
                              </button>
                            );
                          })}
                      </div>
                    </div>

                    {drawerMode === "add" ? (
                      <div className="wl-field">
                        <span className="wl-field-label">Add to</span>
                        <label className={`wl-radio${!createNewList ? " is-on" : ""}`}>
                          <input type="radio" checked={!createNewList} onChange={() => setCreateNewList(false)} name="wl-drawer-list" />
                          <span className="wl-radio-dot" />
                          My watchlist
                        </label>
                        <label className={`wl-radio${createNewList ? " is-on" : ""}`}>
                          <input type="radio" checked={createNewList} onChange={() => setCreateNewList(true)} name="wl-drawer-list" />
                          <span className="wl-radio-dot" />
                          Create new watchlist
                        </label>
                        {createNewList ? (
                          <input
                            className="wl-input wl-newlist-input"
                            placeholder="e.g. Long-term portfolio"
                            value={newListName}
                            onChange={(event) => setNewListName(event.target.value)}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="wl-drawer-foot">
                    <button className="action-button wl-full-btn" disabled={isSaving} onClick={confirmDrawer} type="button">
                      {drawerMode === "edit" ? "Save changes" : "Add to watchlist"}
                    </button>
                  </div>
                </aside>
              </div>
            );
          })()
        : null}

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
