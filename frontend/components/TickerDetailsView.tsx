"use client";

import Link from "next/link";
import {
  Component,
  type ErrorInfo,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import {
  api,
  type CurrentPosition,
  type DecimalValue,
  type MarketCandle,
  type MarketQuote,
  type PositionLot,
  type SymbolSearchResult,
} from "@/lib/api";
import { DETAILS_DEMO } from "@/lib/detailsDemo";
import { formatDisplayDate } from "@/lib/format";

const QUOTE_REFRESH_MS = 15_000;
const CANDLE_REFRESH_MS = 30_000;

const DAY_MS = 86_400_000;

type ChartRange = "1h" | "7d" | "1mo" | "3mo";

// Range buttons for the price chart. `ms` is the x-axis window width: the axis
// always spans the full window ending at "now", so sparse history simply leaves
// the left side empty rather than compressing into the available points.
const CHART_RANGES: { key: ChartRange; label: string; ms: number }[] = [
  { key: "1h", label: "1H", ms: 3_600_000 },
  { key: "7d", label: "7D", ms: 7 * DAY_MS },
  { key: "1mo", label: "1M", ms: 30 * DAY_MS },
  { key: "3mo", label: "3M", ms: 90 * DAY_MS },
];

function chartRangeMs(range: ChartRange): number {
  return CHART_RANGES.find((entry) => entry.key === range)?.ms ?? 3_600_000;
}

type DetailsData = {
  candles: NormalizedMarketCandle[];
  position: CurrentPosition | null;
  quote: NormalizedMarketQuote | null;
};

type RefreshState = {
  lastRefreshedAt: string | null;
  warning: string | null;
};

type NormalizedMarketQuote = Omit<
  MarketQuote,
  "ask_price" | "bid_price" | "last_bar_close" | "last_price" | "previous_close"
> & {
  ask_price: number | null;
  bid_price: number | null;
  last_bar_close: number | null;
  last_price: number | null;
  previous_close: number | null;
  active_feed?: string | null;
  bid_ask_provider?: string | null;
  bid_ask_feed?: string | null;
  bid_ask_timestamp?: string | null;
  bid_ask_stale_seconds?: number | null;
  data_source?: string | null;
  is_stale?: boolean;
  source_timestamp?: string | null;
  stale_seconds?: number | null;
  status_label?: string | null;
};

type NormalizedMarketCandle = Omit<
  MarketCandle,
  "close" | "high" | "low" | "open" | "volume" | "vwap"
> & {
  close: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  vwap: number | null;
};

type MarketChartPoint = {
  feed: string;
  price: number;
  provider: string;
  source: "candle close" | "live quote";
  time: number;
  timestamp: string;
};

function decimalNumber(value: DecimalValue | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function marketPriceNumber(value: DecimalValue | undefined): number | null {
  const number = decimalNumber(value);
  return number !== null && number > 0 ? number : null;
}

function formatNumber(value: DecimalValue | undefined, maximumFractionDigits = 2): string {
  const number = decimalNumber(value);
  const minimumFractionDigits = Math.min(2, maximumFractionDigits);
  return number === null
    ? "--"
    : number.toLocaleString(undefined, {
        minimumFractionDigits,
        maximumFractionDigits,
      });
}

function formatCurrency(value: DecimalValue | undefined, currency = "USD"): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }
  return new Intl.NumberFormat(undefined, {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(number);
}

// US$-prefixed money, matching the editorial Positions/Dashboard surfaces
// (Intl's "currency" style renders "$" which reads as generic; the brand uses
// the explicit "US$" form).
function formatUsd(value: DecimalValue | undefined): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }
  const formatted = Math.abs(number).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${number < 0 ? "-" : ""}US$${formatted}`;
}

function formatSignedUsd(value: DecimalValue | undefined): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  const formatted = Math.abs(number).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}US$${formatted}`;
}

// `value` is a fraction (e.g. -0.0725 → "−7.25%").
function formatSignedPctFraction(value: DecimalValue | undefined): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  return `${sign}${Math.abs(number * 100).toFixed(2)}%`;
}

// Whole days between an ISO open timestamp and now, for the lot holding period.
function holdingDays(openIso: string | null): number | null {
  if (!openIso) {
    return null;
  }
  const opened = new Date(openIso).getTime();
  if (!Number.isFinite(opened)) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - opened) / DAY_MS));
}

function monthYearLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function moneyTone(value: DecimalValue | undefined): "up" | "down" | "flat" {
  const number = decimalNumber(value);
  if (number === null || number === 0) {
    return "flat";
  }
  return number > 0 ? "up" : "down";
}

// A lot's return as a fraction, preferring price-based math and falling back to
// pnl ÷ cost basis (mirrors the lots table's own calculation).
function lotPnlFraction(lot: PositionLot): number | null {
  const mark = decimalNumber(lot.mark_price);
  const cost = decimalNumber(lot.cost_basis_price);
  if (mark !== null && cost !== null && cost !== 0) {
    return (mark - cost) / cost;
  }
  const pnl = decimalNumber(lot.unrealized_pnl);
  const basis = decimalNumber(lot.cost_basis_money);
  if (pnl !== null && basis !== null && basis !== 0) {
    return pnl / Math.abs(basis);
  }
  return null;
}

function lotKey(lot: PositionLot): string {
  return (
    lot.originating_transaction_id ??
    `${lot.open_datetime ?? "?"}:${String(lot.quantity ?? "?")}:${String(lot.cost_basis_price ?? "?")}`
  );
}

type TimelineLot = {
  lot: PositionLot;
  lotNumber: number;
};

// Sort lots oldest-first and assign 1-based lot numbers in that order, so the
// earliest purchase is "Lot 1" regardless of display order.
function buildTimelineLots(lots: PositionLot[]): TimelineLot[] {
  return [...lots]
    .sort((a, b) => {
      const at = a.open_datetime ? new Date(a.open_datetime).getTime() : 0;
      const bt = b.open_datetime ? new Date(b.open_datetime).getTime() : 0;
      return at - bt;
    })
    .map((lot, index) => ({ lot, lotNumber: index + 1 }));
}

function formatFeed(value: string | null | undefined): string {
  if (typeof value !== "string" || !value) {
    return "--";
  }
  return value.toUpperCase();
}

function formatProviderFeed(provider: string | null | undefined, feed: string | null | undefined): string {
  const providerLabel = formatFeed(provider);
  const feedLabel = formatFeed(feed);
  if (providerLabel === "YAHOO") {
    return "YAHOO";
  }
  if (providerLabel === "--") {
    return feedLabel;
  }
  if (providerLabel === feedLabel) {
    return providerLabel;
  }
  return `${providerLabel} ${feedLabel}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  const datePart = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart}`;
}

// US equities (including the Blue Ocean overnight session the market-data
// worker depends on) trade Sunday 20:00 ET through Friday 20:00 ET. Outside
// that window the upstream feed is dark, so the page has no live data and we
// show a dedicated "markets closed" state instead of a stale price.
function isUsMarketWeekend(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  if (weekday === "Sat") {
    return true;
  }
  if (weekday === "Sun") {
    return hour < 20;
  }
  if (weekday === "Fri") {
    return hour >= 20;
  }
  return false;
}

// A quote older than this is treated as "feed dark" — covers exchange holidays
// (and any prolonged outage) where the market-data worker stops producing
// fresh ticks even on a weekday, so the page shows the closed state.
const STALE_CLOSED_SECONDS = 30 * 60;

// Logo assets live in /public; keyed by the resolved market-data provider.
// `height` is per-logo because the artwork aspect ratios differ sharply
// (Alpaca is a square logomark; Yahoo is a wide wordmark).
const PROVIDER_LOGOS: Record<string, { src: string; alt: string; height: number }> = {
  alpaca: { src: "/alpaca-securities-llc-logo-vector.svg", alt: "Alpaca", height: 28},
  yahoo: { src: "/Yahoo!_Finance_logo.svg", alt: "Yahoo Finance", height: 15 },
};

// Frontend mirror of backend/app/services/alpaca_feed.py routing: the active
// provider rotates by ET wall-clock so the "Data provided by" logo matches the
// feed actually serving quotes. Used as a fallback when the live quote doesn't
// carry an explicit provider.
function resolveProviderByTime(now: Date): "alpaca" | "yahoo" {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    })
      .formatToParts(now)
      .find((part) => part.type === "hour")?.value ?? "0",
  ) % 24;
  // 20:00–04:00 → Alpaca overnight; 08:00–17:00 → Alpaca IEX; the two gap
  // windows (04:00–08:00, 17:00–20:00) fall back to Yahoo.
  if (hour >= 20 || hour < 4) {
    return "alpaca";
  }
  if (hour >= 8 && hour < 17) {
    return "alpaca";
  }
  return "yahoo";
}

function formatTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function safeText(value: unknown, fallback = "--"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : value;
}

function normalizeQuote(value: unknown, fallbackSymbol: string): NormalizedMarketQuote | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<MarketQuote>;
  const symbol = safeText(row.symbol, fallbackSymbol).toUpperCase();
  const updatedAt = validTimestamp(row.updated_at) ?? "";
  return {
    symbol,
    provider: safeText(row.provider, "unknown"),
    active_provider: typeof row.active_provider === "string" ? row.active_provider : null,
    active_feed: typeof row.active_feed === "string" ? row.active_feed : null,
    feed: safeText(row.feed, "unknown"),
    market_session: typeof row.market_session === "string" ? row.market_session : null,
    last_price: marketPriceNumber(row.last_price),
    bid_price: marketPriceNumber(row.bid_price),
    ask_price: marketPriceNumber(row.ask_price),
    bid_ask_provider: typeof row.bid_ask_provider === "string" ? row.bid_ask_provider : null,
    bid_ask_feed: typeof row.bid_ask_feed === "string" ? row.bid_ask_feed : null,
    bid_ask_timestamp: validTimestamp(row.bid_ask_timestamp) ?? null,
    bid_ask_stale_seconds:
      typeof row.bid_ask_stale_seconds === "number" && Number.isFinite(row.bid_ask_stale_seconds)
        ? row.bid_ask_stale_seconds
        : null,
    last_bar_close: marketPriceNumber(row.last_bar_close),
    previous_close: marketPriceNumber(row.previous_close),
    data_source: typeof row.data_source === "string" ? row.data_source : null,
    is_stale: row.is_stale === true,
    source_timestamp: validTimestamp(row.source_timestamp) ?? null,
    stale_seconds: typeof row.stale_seconds === "number" && Number.isFinite(row.stale_seconds) ? row.stale_seconds : null,
    status_label: typeof row.status_label === "string" ? row.status_label : null,
    reason: typeof row.reason === "string" ? row.reason : null,
    updated_at: updatedAt,
  };
}

function normalizeCandles(value: unknown, fallbackSymbol: string): NormalizedMarketCandle[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): NormalizedMarketCandle[] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as Partial<MarketCandle>;
    const timestamp = validTimestamp(row.timestamp);
    const open = decimalNumber(row.open);
    const high = decimalNumber(row.high);
    const low = decimalNumber(row.low);
    const close = decimalNumber(row.close);
    if (!timestamp || open === null || high === null || low === null || close === null) {
      return [];
    }

    return [
      {
        symbol: safeText(row.symbol, fallbackSymbol).toUpperCase(),
        provider: safeText(row.provider, "unknown"),
        feed: safeText(row.feed, "unknown"),
        timeframe: safeText(row.timeframe, "1m"),
        timestamp,
        open,
        high,
        low,
        close,
        volume: decimalNumber(row.volume) ?? 0,
        vwap: decimalNumber(row.vwap),
      },
    ];
  });
}

function normalizePositions(value: unknown): CurrentPosition[] {
  return Array.isArray(value) ? (value as CurrentPosition[]) : [];
}

type DetailsBoundaryProps = {
  candlesCount: number;
  children: ReactNode;
  fallbackCandles: NormalizedMarketCandle[];
  quoteExists: boolean;
};

type DetailsBoundaryState = {
  errorMessage: string | null;
  hasError: boolean;
};

class MarketDataBoundary extends Component<DetailsBoundaryProps, DetailsBoundaryState> {
  state: DetailsBoundaryState = { errorMessage: null, hasError: false };

  static getDerivedStateFromError(error: Error): DetailsBoundaryState {
    return { errorMessage: error.message, hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Details market data panel render failed", {
      message: error.message,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="details-panel-state">
          <EmptyState
            message={`candles=${this.props.candlesCount}; quote=${this.props.quoteExists ? "yes" : "no"}; error=${this.state.errorMessage ?? "unknown"}`}
            title="Market data temporarily unavailable"
          />
          <CandleFallbackList candles={this.props.fallbackCandles} />
        </div>
      );
    }

    return this.props.children;
  }
}

function CandleFallbackList({ candles }: { candles: NormalizedMarketCandle[] }) {
  if (candles.length === 0) {
    return null;
  }

  return (
    <div className="details-candle-fallback" aria-label="Recent candle fallback">
      {candles.slice(-5).map((candle) => (
        <div key={`${candle.provider}:${candle.feed}:${candle.timeframe}:${candle.timestamp}`}>
          <span>{formatTime(candle.timestamp)}</span>
          <strong>{formatCurrency(candle.close)}</strong>
          <span>{formatNumber(candle.volume, 0)} vol</span>
        </div>
      ))}
    </div>
  );
}

function minuteBucket(time: number): number {
  return Math.floor(time / 60_000);
}

function liveQuotePrice(quote: NormalizedMarketQuote | null): number | null {
  if (!quote) {
    return null;
  }
  if (quote.last_price !== null) {
    return quote.last_price;
  }
  if (quote.bid_price !== null && quote.ask_price !== null) {
    return (quote.bid_price + quote.ask_price) / 2;
  }
  return null;
}

function mergeMarketChartPoints(
  candles: NormalizedMarketCandle[],
  quote: NormalizedMarketQuote | null,
): MarketChartPoint[] {
  const points = candles
    .flatMap((candle): MarketChartPoint[] => {
      const time = new Date(candle.timestamp).getTime();
      if (!Number.isFinite(time) || !Number.isFinite(candle.close)) {
        return [];
      }
      return [
        {
          feed: candle.feed,
          price: candle.close,
          provider: candle.provider,
          source: "candle close",
          time,
          timestamp: candle.timestamp,
        },
      ];
    })
    .sort((a, b) => a.time - b.time);

  const livePrice = liveQuotePrice(quote);
  const liveTimestamp = validTimestamp(quote?.source_timestamp) ?? validTimestamp(quote?.updated_at);
  const liveTime = liveTimestamp ? new Date(liveTimestamp).getTime() : Number.NaN;
  if (livePrice === null || !Number.isFinite(liveTime) || !liveTimestamp || !quote) {
    return points;
  }

  const livePoint: MarketChartPoint = {
    feed: quote.feed,
    price: livePrice,
    provider: quote.provider,
    source: "live quote",
    time: liveTime,
    timestamp: liveTimestamp,
  };
  const lastPoint = points.at(-1);
  if (!lastPoint) {
    return [livePoint];
  }
  if (Math.abs(livePoint.price - lastPoint.price) < 0.000001) {
    return points;
  }
  if (minuteBucket(livePoint.time) === minuteBucket(lastPoint.time)) {
    return [...points.slice(0, -1), livePoint].sort((a, b) => a.time - b.time);
  }
  if (livePoint.time > lastPoint.time) {
    return [...points, livePoint];
  }
  return points;
}

const PRICE_STEP_MULTIPLIERS = [1, 2, 2.5, 5, 10];
const TIME_STEP_MINUTES = [
  1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440, 2880, 10_080, 20_160, 43_200,
];

// Below ~36h the x-axis shows clock time; longer windows show calendar dates.
function formatAxisLabel(time: number, rangeMs: number): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  if (rangeMs <= 36 * 3_600_000) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function nicePriceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return 1;
  }
  const power = 10 ** Math.floor(Math.log10(rawStep));
  for (const multiplier of PRICE_STEP_MULTIPLIERS) {
    if (multiplier * power >= rawStep) {
      return multiplier * power;
    }
  }
  return 10 * power;
}

function priceTickValues(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return [];
  }
  // Evenly spaced ticks across the visible range, rounded to integers. A fixed
  // count keeps the axis readable; "nice" rounded steps would collapse to just
  // 2 ticks on the tight price ranges these charts usually show.
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    values.push(Math.round(min + (span * i) / (count - 1)));
  }
  // Dedupe in case rounding collapses neighbours on a very tight range.
  return Array.from(new Set(values));
}

function timeTickValues(minTime: number, maxTime: number, targetCount = 5): number[] {
  const spanMinutes = (maxTime - minTime) / 60_000;
  if (!Number.isFinite(spanMinutes) || spanMinutes <= 0) {
    return [];
  }
  const stepMinutes =
    TIME_STEP_MINUTES.find((candidate) => spanMinutes / candidate <= targetCount) ??
    TIME_STEP_MINUTES[TIME_STEP_MINUTES.length - 1];
  const stepMs = stepMinutes * 60_000;
  const first = Math.ceil(minTime / stepMs) * stepMs;
  const ticks: number[] = [];
  for (let time = first; time <= maxTime; time += stepMs) {
    ticks.push(time);
  }
  return ticks;
}

function PriceLineChart({
  candles,
  feed,
  quote,
  rangeMs,
  anchored = false,
  resting = false,
}: {
  candles: NormalizedMarketCandle[];
  feed: string;
  quote: NormalizedMarketQuote | null;
  rangeMs: number;
  // When markets are closed the latest candle can be days old; anchor the
  // x-axis window to that candle (instead of "now") so the last stored session
  // fills the chart rather than sitting off-screen to the left.
  anchored?: boolean;
  // Render in a muted "resting" palette while the market is closed.
  resting?: boolean;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chart = useMemo(() => {
    const allPoints = mergeMarketChartPoints(candles, quote);

    if (allPoints.length < 2) {
      return null;
    }

    const width = 720;
    const height = 280;
    // Small left/right inset for the plot. Kept tight so the line starts close
    // to the y-axis tick labels (the gap between ticks and the line is this
    // inset plus the label offset, not the panel padding).
    const paddingX = 6;
    const paddingTop = 18;
    const paddingBottom = 14;
    // The x-axis spans the full selected window ending at "now" (or the latest
    // point if it is somehow newer / anchored when markets are closed), so
    // sparse history leaves the left side empty instead of stretching a few
    // points across the whole chart.
    const dataMaxTime = allPoints[allPoints.length - 1].time;
    const maxTime = anchored ? dataMaxTime : Math.max(Date.now(), dataMaxTime);
    const minTime = maxTime - rangeMs;
    // Drop points outside the visible window. Otherwise a point just older than
    // the window renders left of the plot: the line gets clipped there but the
    // hover marker still snaps to it, showing a disconnected dot over the
    // y-axis. Fall back to all points only if the window is too sparse to draw.
    const windowPoints = allPoints.filter((point) => point.time >= minTime && point.time <= maxTime);
    const points = windowPoints.length >= 2 ? windowPoints : allPoints;

    const rawMinPrice = Math.min(...points.map((point) => point.price));
    const rawMaxPrice = Math.max(...points.map((point) => point.price));
    const rawSpread = rawMaxPrice - rawMinPrice;
    const centerPrice = (rawMinPrice + rawMaxPrice) / 2;
    const minimumVisibleSpread = Math.max(Math.abs(centerPrice) * 0.0005, 0.1);
    const visibleSpread = Math.max(rawSpread, minimumVisibleSpread);
    const minPrice = centerPrice - visibleSpread / 2 - visibleSpread * 0.08;
    const maxPrice = centerPrice + visibleSpread / 2 + visibleSpread * 0.08;
    const priceSpread = maxPrice - minPrice || 1;
    const timeSpread = maxTime - minTime || 1;
    const plotWidth = width - paddingX * 2;
    const plotHeight = height - paddingTop - paddingBottom;
    const xForTime = (time: number) => paddingX + ((time - minTime) / timeSpread) * plotWidth;
    const yForPrice = (price: number) => paddingTop + (1 - (price - minPrice) / priceSpread) * plotHeight;
    const plottedPoints = points.map((point) => ({
      ...point,
      x: xForTime(point.time),
      y: yForPrice(point.price),
    }));
    const line = plottedPoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const area = [
      `M ${plottedPoints[0].x.toFixed(2)} ${(height - paddingBottom).toFixed(2)}`,
      `L ${line}`,
      `L ${plottedPoints[plottedPoints.length - 1].x.toFixed(2)} ${(height - paddingBottom).toFixed(2)}`,
      "Z",
    ].join(" ");
    const yTicks = priceTickValues(minPrice, maxPrice).map((value) => ({
      value,
      y: yForPrice(value),
      yPercent: (yForPrice(value) / height) * 100,
    }));
    const xTicks = timeTickValues(minTime, maxTime).map((time) => ({
      time,
      x: xForTime(time),
      xPercent: (xForTime(time) / width) * 100,
    }));

    return {
      area,
      latestPoint: points[points.length - 1],
      line,
      plotBottom: height - paddingBottom,
      plotTop: paddingTop,
      plotLeft: paddingX,
      plotRight: width - paddingX,
      points: plottedPoints,
      xTicks,
      yTicks,
      width,
      height,
    };
  }, [candles, quote, rangeMs, anchored]);

  if (!chart) {
    return (
      <div className="details-panel-state">
        <EmptyState
          message="At least two valid candle or quote points are needed for the price chart."
          title="Not enough market data yet"
        />
      </div>
    );
  }

  const activePoint = hoveredIndex === null ? null : chart.points[hoveredIndex] ?? null;
  // The latest point can sit anywhere in the plot (when its candle is older
  // than "now"), so the callout connector runs horizontally from the point's
  // own x out to the tag in the right gutter — not just from the right edge.
  const lastPoint = chart.points[chart.points.length - 1];
  const lastXPercent = (lastPoint.x / chart.width) * 100;
  const lastYPercent = (lastPoint.y / chart.height) * 100;
  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * chart.width;
    const nearestIndex = chart.points.reduce((bestIndex, point, index) => {
      const bestPoint = chart.points[bestIndex];
      return Math.abs(point.x - x) < Math.abs(bestPoint.x - x) ? index : bestIndex;
    }, 0);
    setHoveredIndex(nearestIndex);
  };

  return (
    <div className={`details-price-chart${resting ? " is-resting" : ""}`} aria-label="Price area chart">
      <div className="details-price-chart-canvas">
        <svg
          onMouseLeave={() => setHoveredIndex(null)}
          onMouseMove={handleMouseMove}
          role="img"
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="lite-area-gradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#cc785c" stopOpacity="0.22" />
              <stop offset="70%" stopColor="#cc785c" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#cc785c" stopOpacity="0" />
            </linearGradient>
            {/* Confine the line/area to the plot rectangle so points that fall
                just outside the window never render over the y-axis labels. */}
            <clipPath id="lite-plot-clip">
              <rect
                x={chart.plotLeft}
                y={0}
                width={chart.plotRight - chart.plotLeft}
                height={chart.height}
              />
            </clipPath>
          </defs>
          {chart.yTicks.map((tick) => (
            <line
              key={`y-${tick.value}`}
              className="details-chart-grid-line"
              x1={chart.plotLeft}
              x2={chart.plotRight}
              y1={tick.y}
              y2={tick.y}
            />
          ))}
          <path className="details-chart-area" d={chart.area} clipPath="url(#lite-plot-clip)" />
          <polyline className="details-chart-line" points={chart.line} clipPath="url(#lite-plot-clip)" />
          <circle
            className="details-chart-latest-marker"
            cx={chart.points[chart.points.length - 1].x}
            cy={chart.points[chart.points.length - 1].y}
            r="4.5"
          />
          {activePoint ? (
            <>
              <line
                className="details-chart-hover-line"
                x1={activePoint.x}
                x2={activePoint.x}
                y1={chart.plotTop}
                y2={chart.plotBottom}
              />
              <circle className="details-chart-hover-marker" cx={activePoint.x} cy={activePoint.y} r="5" />
            </>
          ) : null}
        </svg>
        <div className="details-chart-y-labels" aria-hidden="true">
          {chart.yTicks.map((tick) => (
            <span key={`y-label-${tick.value}`} style={{ top: `${tick.yPercent}%` }}>
              {formatNumber(tick.value, 0)}
            </span>
          ))}
        </div>
        {activePoint ? (
          <div
            className={`details-chart-tooltip${(activePoint.y / chart.height) * 100 < 45 ? " is-below" : ""}`}
            style={{
              left: `${Math.min(80, Math.max(20, (activePoint.x / chart.width) * 100))}%`,
              top: `${(activePoint.y / chart.height) * 100}%`,
            }}
          >
            <span>{formatDateTime(activePoint.timestamp)}</span>
            <strong>{formatCurrency(activePoint.price)}</strong>
            <span>{formatProviderFeed(activePoint.provider, activePoint.feed || feed)}</span>
            <span>{activePoint.source}</span>
          </div>
        ) : null}
        <div
          className={`details-chart-latest-connector${resting ? " is-resting" : ""}`}
          style={{
            top: `${lastYPercent}%`,
            left: `${lastXPercent}%`,
            width: `calc(${(100 - lastXPercent).toFixed(3)}% + 20px)`,
          }}
          aria-hidden="true"
        />
        <div
          className={`details-chart-latest-tag${resting ? " is-resting" : ""}`}
          style={{ top: `${lastYPercent}%` }}
          aria-hidden="true"
        >
          {formatNumber(lastPoint.price, 2)}
        </div>
      </div>
      <div className="details-chart-x-labels" aria-hidden="true">
        {chart.xTicks.map((tick) => (
          <span key={`x-label-${tick.time}`} style={{ left: `${tick.xPercent}%` }}>
            {formatAxisLabel(tick.time, rangeMs)}
          </span>
        ))}
      </div>
    </div>
  );
}

// A small decorative sparkline tracing a lot's entry price down/up to the
// current mark. With no per-lot price history available, the curve is a gentle
// deterministic interpolation — enough to read direction at a glance.
function LotSparkline({ startPrice, endPrice }: { startPrice: number | null; endPrice: number | null }) {
  if (startPrice === null || endPrice === null) {
    return null;
  }
  const width = 220;
  const height = 64;
  const padX = 6;
  const padY = 10;
  const steps = 28;
  const min = Math.min(startPrice, endPrice);
  const max = Math.max(startPrice, endPrice);
  const span = max - min || Math.max(Math.abs(max) * 0.01, 1);
  const lo = min - span * 0.3;
  const hi = max + span * 0.3;
  const range = hi - lo || 1;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const eased = 0.5 - Math.cos(t * Math.PI) / 2; // smoothstep
    const wobble = Math.sin(i * 1.3) * span * 0.05 * (1 - t);
    const price = startPrice + (endPrice - startPrice) * eased + wobble;
    const x = padX + t * (width - padX * 2);
    const y = padY + (1 - (price - lo) / range) * (height - padY * 2);
    pts.push([x, y]);
  }
  const down = endPrice < startPrice;
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="dp-lot-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        className={down ? "dp-lot-spark-line is-down" : "dp-lot-spark-line is-up"}
        points={line}
        fill="none"
      />
      <circle className={down ? "dp-lot-spark-dot is-down" : "dp-lot-spark-dot is-up"} cx={last[0]} cy={last[1]} r="3.5" />
    </svg>
  );
}

export function TickerDetailsView({ symbol }: { symbol: string }) {
  const [data, setData] = useState<DetailsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>({
    lastRefreshedAt: null,
    warning: null,
  });
  const dataRef = useRef<DetailsData | null>(null);
  dataRef.current = data;

  // Mirrors `marketClosed` (computed in render) so the polling loop can read it
  // without re-subscribing. When the market is closed the feed is dark, so we
  // stop the periodic refreshes and let the page rest on the last session.
  const marketClosedRef = useRef(false);

  // `?demo` renders the editorial layout from a baked LITE snapshot so the page
  // can be previewed locally without a running backend.
  const [isDemo] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") !== null,
  );

  // Preview-only overrides for eyeballing the market-data status card without
  // waiting for the matching wall-clock window: ?market=open|closed forces the
  // availability state, ?provider=alpaca|yahoo forces the attribution logo.
  const [previewOverrides] = useState(() => {
    if (typeof window === "undefined") {
      return { market: null as string | null, provider: null as string | null };
    }
    const params = new URLSearchParams(window.location.search);
    return { market: params.get("market"), provider: params.get("provider") };
  });

  // Open tax lots for the symbol, used by the position timeline and the
  // selected-lot detail. Fetched alongside the market data below.
  const [lots, setLots] = useState<PositionLot[] | null>(null);
  // Index into the chronologically-sorted lots for the "Selected lot" panel;
  // null falls back to the most recent lot.
  const [selectedLotKey, setSelectedLotKey] = useState<string | null>(null);

  // Selected price-chart window. The candle fetch reads the current value via a
  // ref (so the periodic refresh in the main effect picks up changes without
  // re-subscribing), and a dedicated effect refetches candles when it changes.
  const [chartRange, setChartRange] = useState<ChartRange>("1h");
  const chartRangeRef = useRef<ChartRange>(chartRange);
  chartRangeRef.current = chartRange;

  // Where the user came from drives the back button's label and target.
  // Read from the ?from= query param (set by the linking pages); default to
  // the watchlist when arriving directly or without an origin.
  const [origin, setOrigin] = useState<"positions" | "watchlist">("watchlist");
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("from");
    setOrigin(from === "positions" ? "positions" : "watchlist");
  }, [symbol]);

  // Company name + listing exchange from the Nasdaq Symbol Directory sync.
  // Looked up once per symbol; absent for symbols not in the directory.
  const [symbolInfo, setSymbolInfo] = useState<SymbolSearchResult | null>(null);
  useEffect(() => {
    let active = true;
    setSymbolInfo(null);
    if (isDemo) {
      setSymbolInfo(DETAILS_DEMO.symbolInfo);
      return () => {
        active = false;
      };
    }
    api
      .symbolInfo(symbol)
      .then((info) => {
        if (active) {
          setSymbolInfo(info);
        }
      })
      .catch(() => {
        // 404 (symbol not in directory) or network error: fall back to the
        // generic subtitle below; nothing actionable to surface here.
      });
    return () => {
      active = false;
    };
  }, [symbol, isDemo]);
  const symbolName = symbolInfo?.name?.trim() || null;
  const symbolExchange = symbolInfo?.exchange?.trim() || null;
  const backTarget = origin === "positions"
    ? { href: "/positions", label: "Back to Positions" }
    : { href: "/watchlist", label: "Back to Watchlist" };

  useEffect(() => {
    let active = true;
    // Switching symbols (client-side nav reuses this component): clear the
    // previous symbol's data so the loading state shows and stale rows from
    // the old symbol never flash through.
    setData(null);
    setError(null);
    setLots(null);
    setSelectedLotKey(null);

    if (isDemo) {
      setData({
        candles: normalizeCandles(DETAILS_DEMO.candles, symbol),
        position: { ...DETAILS_DEMO.position, symbol },
        quote: normalizeQuote(DETAILS_DEMO.quote, symbol),
      });
      setLots(DETAILS_DEMO.lots);
      setRefreshState({ lastRefreshedAt: new Date().toISOString(), warning: null });
      return () => {
        active = false;
      };
    }

    // Monotonic counters drop out-of-order responses when a slow request
    // resolves after a newer one.
    let quoteSeq = 0;
    let candleSeq = 0;
    let loadingAll = false;
    let quoteInterval: number | undefined;
    let candleInterval: number | undefined;
    const stopPolling = () => {
      if (quoteInterval !== undefined) {
        window.clearInterval(quoteInterval);
        quoteInterval = undefined;
      }
      if (candleInterval !== undefined) {
        window.clearInterval(candleInterval);
        candleInterval = undefined;
      }
    };

    const markRefreshSuccess = () => {
      setRefreshState({
        lastRefreshedAt: new Date().toISOString(),
        warning: null,
      });
    };

    const markRefreshFailure = (requestError: unknown) => {
      setRefreshState((current) => ({
        ...current,
        warning: requestError instanceof Error ? requestError.message : "Refresh failed.",
      }));
    };

    const loadAll = async () => {
      if (loadingAll) {
        return;
      }
      loadingAll = true;
      const quoteRequest = ++quoteSeq;
      const candleRequest = ++candleSeq;
      try {
        const [quote, candles, positions] = await Promise.all([
          api.marketQuote(symbol),
          api.marketCandles(symbol, { timeframe: "1m", range: chartRangeRef.current }),
          api.positions(),
        ]);
        if (!active || quoteRequest !== quoteSeq || candleRequest !== candleSeq) {
          return;
        }
        const normalizedPositions = normalizePositions(positions);
        const position = normalizedPositions.find((row) => row.symbol?.toUpperCase() === symbol) ?? null;
        setData({
          candles: normalizeCandles(candles, symbol),
          position,
          quote: normalizeQuote(quote, symbol),
        });
        setError(null);
        markRefreshSuccess();
      } catch (requestError) {
        if (!active) {
          return;
        }
        if (dataRef.current === null) {
          setError(requestError instanceof Error ? requestError.message : "Request failed.");
        } else {
          markRefreshFailure(requestError);
        }
      } finally {
        loadingAll = false;
      }
    };

    const refreshQuote = async () => {
      if (dataRef.current === null) {
        // Initial load failed; retry the whole page instead of a partial refresh.
        void loadAll();
        return;
      }
      // Market closed (weekend/holiday): the feed is dark, so stop polling and
      // let the page rest on the last loaded session.
      if (marketClosedRef.current) {
        stopPolling();
        return;
      }
      const request = ++quoteSeq;
      try {
        const quote = await api.marketQuote(symbol);
        if (!active || request !== quoteSeq) {
          return;
        }
        const normalizedQuote = normalizeQuote(quote, symbol);
        setData((current) => (current ? { ...current, quote: normalizedQuote } : current));
        markRefreshSuccess();
      } catch (requestError) {
        if (active) {
          markRefreshFailure(requestError);
        }
      }
    };

    const refreshCandles = async () => {
      if (dataRef.current === null) {
        return;
      }
      if (marketClosedRef.current) {
        stopPolling();
        return;
      }
      const request = ++candleSeq;
      try {
        const candles = await api.marketCandles(symbol, { timeframe: "1m", range: chartRangeRef.current });
        if (!active || request !== candleSeq) {
          return;
        }
        setData((current) => (current ? { ...current, candles: normalizeCandles(candles, symbol) } : current));
        markRefreshSuccess();
      } catch (requestError) {
        if (active) {
          markRefreshFailure(requestError);
        }
      }
    };

    void loadAll();
    // Open lots drive the position timeline + selected-lot panel. A failure
    // here must not block the market data, so swallow the error.
    api
      .lots(symbol)
      .then((rows) => {
        if (active) {
          setLots(Array.isArray(rows) ? rows : []);
        }
      })
      .catch(() => {
        if (active) {
          setLots([]);
        }
      });
    quoteInterval = window.setInterval(refreshQuote, QUOTE_REFRESH_MS);
    candleInterval = window.setInterval(refreshCandles, CANDLE_REFRESH_MS);

    return () => {
      active = false;
      stopPolling();
    };
  }, [symbol, isDemo]);

  // Range switch: refetch candles for the new window without tearing down the
  // page. The initial load is owned by the main effect (which skips here while
  // data is still null), so this only fires on subsequent range changes.
  useEffect(() => {
    if (dataRef.current === null || isDemo) {
      return;
    }
    let active = true;
    api
      .marketCandles(symbol, { timeframe: "1m", range: chartRange })
      .then((candles) => {
        if (active) {
          setData((current) => (current ? { ...current, candles: normalizeCandles(candles, symbol) } : current));
        }
      })
      .catch(() => {
        // Periodic refresh in the main effect will retry; nothing to surface.
      });
    return () => {
      active = false;
    };
  }, [chartRange, symbol, isDemo]);

  const quote = data?.quote ?? null;
  const candles = data?.candles ?? [];
  const position = data?.position ?? null;
  const latestPrice = quote?.last_price ?? quote?.last_bar_close ?? null;
  const previousClose = quote?.previous_close ?? null;
  const changeAmount =
    latestPrice !== null && previousClose !== null ? latestPrice - previousClose : null;
  const changePct =
    latestPrice !== null && previousClose !== null && previousClose !== 0
      ? ((latestPrice - previousClose) / previousClose) * 100
      : null;
  const changeTone = changePct === null || changePct === 0 ? "flat" : changePct > 0 ? "up" : "down";
  const latestCandle = candles.at(-1);
  const liveQuoteTimestamp = quote?.source_timestamp ?? quote?.updated_at ?? null;
  const marketFeed = formatFeed(quote?.feed ?? latestCandle?.feed);
  // The feed is dark over the weekend and on exchange holidays. Weekends are
  // calendar-based; holidays (no public US-holiday list in the app) are inferred
  // from a quote that has stopped updating. Either way we still show whatever
  // last session we have rather than a blank panel.
  const now = new Date();
  const isWeekend = isUsMarketWeekend(now);
  const dataStale =
    quote === null ||
    quote.is_stale === true ||
    (quote.stale_seconds !== null && quote.stale_seconds !== undefined && quote.stale_seconds > STALE_CLOSED_SECONDS);
  const marketClosed =
    previewOverrides.market === "closed"
      ? true
      : previewOverrides.market === "open"
        ? false
        : isWeekend || dataStale;
  marketClosedRef.current = marketClosed;
  const closedReason = isWeekend
    ? "Quotes resume Sunday 8:00 PM ET."
    : "Quotes resume when the exchange reopens.";
  // Which provider is serving live data — prefer the quote's own resolution,
  // fall back to the time-based mirror of the backend routing.
  const activeProviderName = (
    previewOverrides.provider ?? quote?.active_provider ?? quote?.provider ?? resolveProviderByTime(now)
  ).toLowerCase();
  const providerLogo = PROVIDER_LOGOS[activeProviderName] ?? PROVIDER_LOGOS.alpaca;

  // Company name + security type parsed from the directory record
  // ("Lumentum Holdings Inc. - Common Stock" → name + "Common Stock").
  const companyName = symbolName ? symbolName.split(" - ")[0]?.trim() || null : null;
  const securityType = symbolName
    ? symbolName.split(" - ")[1]?.trim() || (symbolInfo?.is_etf ? "ETF" : null)
    : null;
  const listingLine = [securityType, symbolExchange].filter(Boolean).join(" · ");

  // Lots sorted oldest-first with 1-based lot numbers for the timeline.
  const timelineLots = useMemo(() => buildTimelineLots(lots ?? []), [lots]);
  const taxLotCount = timelineLots.length;
  const heldSince = timelineLots.length > 0 ? monthYearLabel(timelineLots[0].lot.open_datetime) : null;

  // The selected lot for the detail panel; defaults to the most recent lot.
  const selectedEntry = useMemo(() => {
    if (timelineLots.length === 0) {
      return null;
    }
    const byKey = selectedLotKey
      ? timelineLots.find((entry) => lotKey(entry.lot) === selectedLotKey)
      : null;
    return byKey ?? timelineLots[timelineLots.length - 1];
  }, [timelineLots, selectedLotKey]);

  const exportLots = () => {
    if (!lots || lots.length === 0) {
      return;
    }
    const header = ["symbol", "quantity", "cost_basis_price", "cost_basis_money", "open_datetime", "unrealized_pnl"];
    const rows = lots.map((lot) =>
      [lot.symbol ?? symbol, lot.quantity, lot.cost_basis_price, lot.cost_basis_money, lot.open_datetime, lot.unrealized_pnl]
        .map((cell) => `"${String(cell ?? "")}"`)
        .join(","),
    );
    const csv = [header.join(","), ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${symbol}-lots.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <div className="details-page">
      <div className="dp-topbar">
        <Link className="dp-back" href={backTarget.href}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {backTarget.label}
        </Link>
      </div>

      {error ? (
        <section className="dp-state">
          <ErrorState message={error} title={`Unable to load ${symbol} details`} />
        </section>
      ) : !data ? (
        <section className="dp-state">
          <LoadingState message={`Loading ${symbol} market data and lots…`} />
        </section>
      ) : (
        <>
          <header className="dp-hero">
            <div className="dp-hero-id">
              <p className="dp-eyebrow">Ticker Details</p>
              <h1 className="dp-symbol">{symbol}</h1>
              {companyName ? <p className="dp-company">{companyName}</p> : null}
              {listingLine ? <p className="dp-listing">{listingLine}</p> : null}
              {heldSince ? (
                <p className="dp-note">
                  Held since {heldSince}.
                  <span className="dp-note-underline" aria-hidden="true" />
                </p>
              ) : null}
            </div>

            <div className="dp-price-block">
              <p className="dp-price-label">{marketClosed ? "Last Close" : "Last Price"}</p>
              <p className="dp-price">{latestPrice !== null ? formatUsd(latestPrice) : "Unavailable"}</p>
              {changePct !== null ? (
                <p className={`dp-change dp-change-${changeTone}`} title="Change vs previous session close">
                  {`${changePct > 0 ? "+" : changePct < 0 ? "−" : ""}${Math.abs(changePct).toFixed(2)}%`}
                  {changeAmount !== null ? (
                    <span className="dp-change-amt">({formatSignedUsd(changeAmount)})</span>
                  ) : null}
                </p>
              ) : null}
              {marketClosed ? (
                <div className="dp-status dp-status-closed" role="status">
                  <p className="dp-status-headline">
                    U.S. markets are closed
                    <span className="dp-status-badge dp-status-badge-closed">
                      <span className="dp-status-moon" aria-hidden="true">☾</span>
                      Closed
                    </span>
                  </p>
                  <p className="dp-status-detail">{closedReason}</p>
                </div>
              ) : (
                <div className="dp-status dp-status-open" role="status">
                  <p className="dp-status-headline">
                    U.S. markets are available
                    <span className="dp-status-badge dp-status-badge-open">
                      <span className="dp-status-dot" aria-hidden="true" />
                      Live
                    </span>
                  </p>
                  <p className="dp-status-attr">
                    Data provided by
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="dp-provider-logo"
                      src={providerLogo.src}
                      alt={providerLogo.alt}
                      style={{ height: providerLogo.height }}
                    />
                  </p>
                </div>
              )}
            </div>

            {position ? (
              <aside className="dp-snapshot">
                <p className="dp-snapshot-title">Position Snapshot</p>
                <dl className="dp-snapshot-list">
                  <div><dt>Shares</dt><dd>{formatNumber(position.total_quantity, 4)}</dd></div>
                  <div><dt>Avg cost</dt><dd>{formatUsd(position.avg_cost)}</dd></div>
                  <div><dt>Market value</dt><dd>{formatUsd(position.market_value)}</dd></div>
                  <div>
                    <dt>Unrealized P&amp;L</dt>
                    <dd className={`dp-pnl-${moneyTone(position.unrealized_pnl)}`}>
                      {formatSignedUsd(position.unrealized_pnl)} ({formatSignedPctFraction(position.unrealized_pnl_pct)})
                    </dd>
                  </div>
                  <div><dt>Tax lots</dt><dd>{taxLotCount || "--"}</dd></div>
                </dl>
              </aside>
            ) : (
              <aside className="dp-snapshot dp-snapshot-empty">
                <p className="dp-snapshot-title">Position Snapshot</p>
                <p className="dp-snapshot-none">Not currently held.</p>
              </aside>
            )}
          </header>

          <section className="dp-chart-panel">
            <div className="dp-panel-head">
              <p className="dp-panel-eyebrow">Price Journey</p>
              <div className="dp-range" role="group" aria-label="Chart range">
                {CHART_RANGES.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={`dp-range-btn${chartRange === entry.key ? " is-active" : ""}`}
                    aria-pressed={chartRange === entry.key}
                    onClick={() => setChartRange(entry.key)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            {!marketClosed && refreshState.warning ? (
              <p className="dp-warning">Refresh issue: {refreshState.warning}</p>
            ) : null}
            <MarketDataBoundary candlesCount={candles.length} fallbackCandles={candles} quoteExists={quote !== null}>
              {candles.length === 0 && !quote ? (
                <div className="dp-panel-state">
                  <EmptyState
                    message={`No quote or candle data is available for ${symbol} yet.`}
                    title="Latest data unavailable"
                  />
                </div>
              ) : (
                <PriceLineChart
                  candles={candles}
                  feed={marketFeed}
                  quote={quote}
                  rangeMs={chartRangeMs(chartRange)}
                  anchored={marketClosed}
                  resting={marketClosed}
                />
              )}
            </MarketDataBoundary>
          </section>

          <section className="dp-stats">
            <article className="dp-stat">
              <span className="dp-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <ellipse cx="16" cy="16" rx="9" ry="7" />
                  <ellipse cx="24" cy="24" rx="9" ry="7" />
                </svg>
              </span>
              <div className="dp-stat-body">
                <span className="dp-stat-value">{position ? formatNumber(position.total_quantity, 4) : "--"}</span>
                <span className="dp-stat-label">Shares</span>
              </div>
            </article>
            <article className="dp-stat">
              <span className="dp-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 7H11v10l13 13 10-10-13-13z" />
                  <circle cx="15.5" cy="11.5" r="1.6" />
                </svg>
              </span>
              <div className="dp-stat-body">
                <span className="dp-stat-value">{position ? formatUsd(position.avg_cost) : "--"}</span>
                <span className="dp-stat-label">Avg cost basis</span>
              </div>
            </article>
            <article className="dp-stat">
              <span className="dp-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 13l9 9 6-6 11 11" />
                  <path d="M33 19v8h-8" />
                </svg>
              </span>
              <div className="dp-stat-body">
                <span className={`dp-stat-value dp-pnl-${position ? moneyTone(position.unrealized_pnl) : "flat"}`}>
                  {position ? formatSignedUsd(position.unrealized_pnl) : "--"}
                </span>
                <span className="dp-stat-label">
                  Unrealized P&amp;L{position ? ` (${formatSignedPctFraction(position.unrealized_pnl_pct)})` : ""}
                </span>
              </div>
            </article>
            <article className="dp-stat">
              <span className="dp-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="10" y="8" width="16" height="20" rx="2" />
                  <path d="M15 28v4h16V12h-4" />
                  <path d="M14 14h8M14 18h8" />
                </svg>
              </span>
              <div className="dp-stat-body">
                <span className="dp-stat-value">{taxLotCount || "--"}</span>
                <span className="dp-stat-label">Tax lots</span>
              </div>
            </article>
          </section>

          <section className="dp-detail-grid" id="dp-detail">
            <article className="dp-timeline-panel">
              <p className="dp-panel-eyebrow">Position Timeline</p>
              <p className="dp-panel-sub">A timeline of your trades in {symbol}.</p>
              {timelineLots.length === 0 ? (
                <div className="dp-panel-state">
                  <EmptyState message={`No open lots for ${symbol}.`} />
                </div>
              ) : (
                <ol className="dp-timeline">
                  <li className="dp-timeline-row dp-timeline-now">
                    <span className="dp-timeline-marker"><span className="dp-timeline-dot is-now" /></span>
                    <span className="dp-timeline-when">Today</span>
                    <span className="dp-timeline-what">Current price {formatUsd(latestPrice)}</span>
                  </li>
                  {[...timelineLots].reverse().map((entry) => {
                    const selected = selectedEntry !== null && lotKey(entry.lot) === lotKey(selectedEntry.lot);
                    return (
                      <li key={lotKey(entry.lot)} className={`dp-timeline-row${selected ? " is-selected" : ""}`}>
                        <button className="dp-timeline-hit" type="button" onClick={() => setSelectedLotKey(lotKey(entry.lot))}>
                          <span className="dp-timeline-marker"><span className="dp-timeline-dot" /></span>
                          <span className="dp-timeline-when">{formatDisplayDate(entry.lot.open_datetime)}</span>
                          <span className="dp-timeline-what">
                            {entry.lotNumber === 1 ? "Bought" : "Added"} {formatNumber(entry.lot.quantity, 4)} shares @ {formatUsd(entry.lot.cost_basis_price)}
                          </span>
                          <span className="dp-lot-tag">Lot {entry.lotNumber}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </article>

            <article className="dp-lot-panel">
              {selectedEntry ? (
                <>
                  <div className="dp-lot-head">
                    <p className="dp-panel-eyebrow">Selected Lot</p>
                    <span className="dp-lot-tag is-strong">Lot {selectedEntry.lotNumber}</span>
                  </div>
                  <p className="dp-lot-date">{formatDisplayDate(selectedEntry.lot.open_datetime)}</p>
                  <p className="dp-lot-line">
                    {selectedEntry.lotNumber === 1 ? "Bought" : "Added"} {formatNumber(selectedEntry.lot.quantity, 4)} shares @ {formatUsd(selectedEntry.lot.cost_basis_price)}
                  </p>
                  <dl className="dp-lot-stats">
                    <div><dt>Cost</dt><dd>{formatUsd(selectedEntry.lot.cost_basis_money)}</dd></div>
                    <div><dt>Current value</dt><dd>{formatUsd(selectedEntry.lot.position_value)}</dd></div>
                    <div>
                      <dt>Unrealized P&amp;L</dt>
                      <dd className={`dp-pnl-${moneyTone(selectedEntry.lot.unrealized_pnl)}`}>
                        {formatSignedUsd(selectedEntry.lot.unrealized_pnl)} ({formatSignedPctFraction(lotPnlFraction(selectedEntry.lot))})
                      </dd>
                    </div>
                    <div>
                      <dt>Holding period</dt>
                      <dd>{(() => { const days = holdingDays(selectedEntry.lot.open_datetime); return days === null ? "--" : `${days} ${days === 1 ? "day" : "days"}`; })()}</dd>
                    </div>
                  </dl>
                  <div className="dp-lot-spark-wrap">
                    <span className="dp-lot-spark-start">{formatNumber(selectedEntry.lot.cost_basis_price)}</span>
                    <LotSparkline
                      startPrice={decimalNumber(selectedEntry.lot.cost_basis_price)}
                      endPrice={decimalNumber(selectedEntry.lot.mark_price)}
                    />
                    <span className="dp-lot-spark-end">{formatNumber(selectedEntry.lot.mark_price)}</span>
                  </div>
                </>
              ) : (
                <div className="dp-panel-state">
                  <EmptyState message="Select a lot from the timeline to see its detail." />
                </div>
              )}
            </article>
          </section>

          <section className="dp-cta">
            <span className="dp-cta-art" aria-hidden="true">
              <svg viewBox="0 0 96 84" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M40 74V44" />
                <path d="M40 52C40 44 33 38 24 38c0 8 7 14 16 14z" />
                <path d="M40 48c0-9 7-16 17-16 0 9-8 16-17 16z" />
                <path d="M40 60c0-6 5-11 12-11 0 6-5 11-12 11z" />
                <path d="M30 74h20l-2 8H32z" />
              </svg>
            </span>
            <div className="dp-cta-copy">
              <p className="dp-cta-title">What would you like to do?</p>
              <p className="dp-cta-sub">Manage your position or export your data.</p>
            </div>
            <div className="dp-cta-actions">
              <button className="dp-btn dp-btn-primary" type="button" onClick={scrollToTop}>
                Review Position <span aria-hidden="true">→</span>
              </button>
              <Link className="dp-btn" href="/trades">Add Shares</Link>
              <Link className="dp-btn" href="/trades">Sell Shares</Link>
              <button className="dp-btn" type="button" onClick={exportLots}>Export Lots</button>
            </div>
          </section>

          <p className="dp-footnote">Quotes are delayed during market hours. Night session data is indicative.</p>
        </>
      )}
    </div>
  );
}
