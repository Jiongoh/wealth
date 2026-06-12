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
import { LotsView } from "@/components/LotsView";
import {
  api,
  type CurrentPosition,
  type DecimalValue,
  type MarketCandle,
  type MarketQuote,
} from "@/lib/api";

const PILOT_SYMBOL = "LITE";
const QUOTE_REFRESH_MS = 15_000;
const CANDLE_REFRESH_MS = 30_000;

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
  "ask_price" | "bid_price" | "last_bar_close" | "last_price"
> & {
  ask_price: number | null;
  bid_price: number | null;
  last_bar_close: number | null;
  last_price: number | null;
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

function formatSignedCurrency(value: DecimalValue | undefined): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }
  return formatCurrency(number);
}

function formatFeed(value: string | null | undefined): string {
  if (typeof value !== "string" || !value) {
    return "--";
  }
  return value.toUpperCase();
}

function formatStatusLabel(value: string | null | undefined): string {
  if (value === "fallback") {
    return "Fallback";
  }
  if (value === "latest_available") {
    return "Latest available";
  }
  if (value === "realtime") {
    return "Realtime";
  }
  if (value === "delayed") {
    return "Delayed";
  }
  if (value === "stale") {
    return "Stale";
  }
  return safeText(value, "--");
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

function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "--";
  }
  if (seconds < 60) {
    return `${Math.max(0, Math.round(seconds))}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.round(seconds / 3600)}h ago`;
  }
  return `${Math.round(seconds / 86_400)}d ago`;
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

function pnlClass(value: DecimalValue | undefined): string {
  const number = decimalNumber(value);
  if (number === null || number === 0) {
    return "";
  }
  return number > 0 ? "pnl-positive" : "pnl-negative";
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

function normalizeQuote(value: unknown): NormalizedMarketQuote | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<MarketQuote>;
  const symbol = safeText(row.symbol, PILOT_SYMBOL).toUpperCase();
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
    data_source: typeof row.data_source === "string" ? row.data_source : null,
    is_stale: row.is_stale === true,
    source_timestamp: validTimestamp(row.source_timestamp) ?? null,
    stale_seconds: typeof row.stale_seconds === "number" && Number.isFinite(row.stale_seconds) ? row.stale_seconds : null,
    status_label: typeof row.status_label === "string" ? row.status_label : null,
    reason: typeof row.reason === "string" ? row.reason : null,
    updated_at: updatedAt,
  };
}

function normalizeCandles(value: unknown): NormalizedMarketCandle[] {
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
        symbol: safeText(row.symbol, PILOT_SYMBOL).toUpperCase(),
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
    console.error("LITE market data panel render failed", {
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
const TIME_STEP_MINUTES = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440];

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

function priceTickValues(min: number, max: number, targetCount = 4): number[] {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return [];
  }
  const step = nicePriceStep(span / targetCount);
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max + step * 1e-6; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks;
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
}: {
  candles: NormalizedMarketCandle[];
  feed: string;
  quote: NormalizedMarketQuote | null;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chart = useMemo(() => {
    const points = mergeMarketChartPoints(candles, quote);

    if (points.length < 2) {
      return null;
    }

    const width = 720;
    const height = 280;
    const paddingX = 14;
    const paddingTop = 18;
    const paddingBottom = 14;
    const rawMinPrice = Math.min(...points.map((point) => point.price));
    const rawMaxPrice = Math.max(...points.map((point) => point.price));
    const rawSpread = rawMaxPrice - rawMinPrice;
    const centerPrice = (rawMinPrice + rawMaxPrice) / 2;
    const minimumVisibleSpread = Math.max(Math.abs(centerPrice) * 0.0005, 0.1);
    const visibleSpread = Math.max(rawSpread, minimumVisibleSpread);
    const minPrice = centerPrice - visibleSpread / 2 - visibleSpread * 0.08;
    const maxPrice = centerPrice + visibleSpread / 2 + visibleSpread * 0.08;
    const priceSpread = maxPrice - minPrice || 1;
    const minTime = points[0].time;
    const maxTime = points[points.length - 1].time;
    const timeSpread = maxTime - minTime || 1;
    const plotWidth = width - paddingX * 2;
    const plotHeight = height - paddingTop - paddingBottom;
    const xForTime = (time: number, index = 0) =>
      maxTime === minTime
        ? paddingX + (index / Math.max(points.length - 1, 1)) * plotWidth
        : paddingX + ((time - minTime) / timeSpread) * plotWidth;
    const yForPrice = (price: number) => paddingTop + (1 - (price - minPrice) / priceSpread) * plotHeight;
    const plottedPoints = points.map((point, index) => ({
      ...point,
      x: xForTime(point.time, index),
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
  }, [candles, quote]);

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
    <div className="details-price-chart" aria-label="LITE price area chart">
      <div className="details-price-chart-meta">
        <span>{chart.latestPoint.source === "live quote" ? "Latest quote" : "Latest close"}</span>
        <strong>{formatCurrency(chart.latestPoint.price)}</strong>
      </div>
      <div className="details-price-chart-canvas">
        <svg
          onMouseLeave={() => setHoveredIndex(null)}
          onMouseMove={handleMouseMove}
          role="img"
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          preserveAspectRatio="none"
        >
          <title>LITE price area chart</title>
          <defs>
            <linearGradient id="lite-area-gradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#d49a1f" stopOpacity="0.2" />
              <stop offset="70%" stopColor="#d49a1f" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#d49a1f" stopOpacity="0" />
            </linearGradient>
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
          {chart.xTicks.map((tick) => (
            <line
              key={`x-${tick.time}`}
              className="details-chart-grid-line"
              x1={tick.x}
              x2={tick.x}
              y1={chart.plotTop}
              y2={chart.plotBottom}
            />
          ))}
          <path className="details-chart-area" d={chart.area} />
          <polyline className="details-chart-line" points={chart.line} />
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
              {formatNumber(tick.value)}
            </span>
          ))}
        </div>
        {activePoint ? (
          <div
            className="details-chart-tooltip"
            style={{
              left: `${Math.min(86, Math.max(14, (activePoint.x / chart.width) * 100))}%`,
              top: `${Math.min(76, Math.max(16, (activePoint.y / chart.height) * 100))}%`,
            }}
          >
            <span>{formatDateTime(activePoint.timestamp)}</span>
            <strong>{formatCurrency(activePoint.price)}</strong>
            <span>{formatFeed(activePoint.feed || feed)}</span>
            <span>{formatFeed(activePoint.provider)}</span>
            <span>{activePoint.source}</span>
          </div>
        ) : null}
      </div>
      <div className="details-chart-x-labels" aria-hidden="true">
        {chart.xTicks.map((tick) => (
          <span key={`x-label-${tick.time}`} style={{ left: `${tick.xPercent}%` }}>
            {formatTime(tick.time)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TickerDetailsView() {
  const [data, setData] = useState<DetailsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>({
    lastRefreshedAt: null,
    warning: null,
  });
  const dataRef = useRef<DetailsData | null>(null);
  dataRef.current = data;

  useEffect(() => {
    let active = true;
    // Monotonic counters drop out-of-order responses when a slow request
    // resolves after a newer one.
    let quoteSeq = 0;
    let candleSeq = 0;
    let loadingAll = false;

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
          api.marketQuote(PILOT_SYMBOL),
          api.marketCandles(PILOT_SYMBOL, { timeframe: "1m", range: "1h" }),
          api.positions(),
        ]);
        if (!active || quoteRequest !== quoteSeq || candleRequest !== candleSeq) {
          return;
        }
        const normalizedPositions = normalizePositions(positions);
        const position = normalizedPositions.find((row) => row.symbol?.toUpperCase() === PILOT_SYMBOL) ?? null;
        setData({
          candles: normalizeCandles(candles),
          position,
          quote: normalizeQuote(quote),
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
      const request = ++quoteSeq;
      try {
        const quote = await api.marketQuote(PILOT_SYMBOL);
        if (!active || request !== quoteSeq) {
          return;
        }
        const normalizedQuote = normalizeQuote(quote);
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
      const request = ++candleSeq;
      try {
        const candles = await api.marketCandles(PILOT_SYMBOL, { timeframe: "1m", range: "1h" });
        if (!active || request !== candleSeq) {
          return;
        }
        setData((current) => (current ? { ...current, candles: normalizeCandles(candles) } : current));
        markRefreshSuccess();
      } catch (requestError) {
        if (active) {
          markRefreshFailure(requestError);
        }
      }
    };

    void loadAll();
    const quoteInterval = window.setInterval(refreshQuote, QUOTE_REFRESH_MS);
    const candleInterval = window.setInterval(refreshCandles, CANDLE_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(quoteInterval);
      window.clearInterval(candleInterval);
    };
  }, []);

  const quote = data?.quote ?? null;
  const candles = data?.candles ?? [];
  const position = data?.position ?? null;
  const latestPrice = quote?.last_price ?? quote?.last_bar_close ?? null;
  const latestCandle = candles.at(-1);
  const liveQuoteTimestamp = quote?.source_timestamp ?? quote?.updated_at ?? null;
  const marketFeed = formatFeed(quote?.feed ?? latestCandle?.feed);
  const providerFeed = formatProviderFeed(quote?.provider, quote?.feed ?? latestCandle?.feed);
  const activeProviderFeed = formatProviderFeed(quote?.active_provider, quote?.active_feed);
  const quoteStatus = formatStatusLabel(quote?.status_label);
  const hasBidAsk = quote?.bid_price !== null && quote?.bid_price !== undefined
    && quote?.ask_price !== null && quote?.ask_price !== undefined;
  const bidAskSource = formatProviderFeed(quote?.bid_ask_provider ?? quote?.provider, quote?.bid_ask_feed ?? quote?.feed);
  const bidAskAge = quote?.bid_ask_stale_seconds ?? null;
  const bidAskIsOld = bidAskAge !== null && bidAskAge > 120;

  return (
    <>
      <div className="page-header details-page-header">
        <div>
          <p className="eyebrow">Ticker details pilot</p>
          <h1>{PILOT_SYMBOL}</h1>
          <p className="page-description">A focused market data and lots view for the LITE details pilot.</p>
        </div>
        <Link className="action-link" href={`/lots?symbol=${PILOT_SYMBOL}&from=positions`}>
          Open Lots
        </Link>
      </div>

      {error ? (
        <section className="dashboard-state">
          <ErrorState message={error} title="Unable to load LITE details" />
        </section>
      ) : !data ? (
        <section className="dashboard-state">
          <LoadingState message="Loading LITE market data and lots..." />
        </section>
      ) : (
        <>
          <section className="details-hero panel">
            <div className="details-hero-main">
              <span className="details-symbol">Current Price</span>
              <strong>{quote ? formatCurrency(latestPrice) : "Latest data unavailable"}</strong>
              <div className="details-bid-ask" aria-label="Bid and ask">
                <span className="details-bid-ask-pair">
                  <span>Bid</span>
                  <strong>{formatCurrency(quote?.bid_price ?? null)}</strong>
                </span>
                <span className="details-bid-ask-divider">/</span>
                <span className="details-bid-ask-pair">
                  <span>Ask</span>
                  <strong>{formatCurrency(quote?.ask_price ?? null)}</strong>
                </span>
                {hasBidAsk ? (
                  <span className={`details-bid-ask-age${bidAskIsOld ? " is-old" : ""}`}>
                    {bidAskSource}
                    {bidAskAge !== null ? ` · ${formatAge(bidAskAge)}` : ""}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="details-hero-meta" aria-label="Market data status">
              <span>
                Status: {quoteStatus}
                {quote?.is_stale && quote.stale_seconds !== null ? ` (${formatAge(quote.stale_seconds)})` : ""}
              </span>
              <span>Source: {providerFeed}{providerFeed !== activeProviderFeed && activeProviderFeed !== "--" ? ` (active: ${activeProviderFeed})` : ""}</span>
              <span>Session: {safeText(quote?.market_session, "--")}</span>
              <span>Price time: {formatDateTime(liveQuoteTimestamp)}</span>
            </div>
          </section>

          <section className="details-grid">
            <article className="panel details-market-panel">
              <MarketDataBoundary candlesCount={candles.length} fallbackCandles={candles} quoteExists={quote !== null}>
                <div className="panel-header">
                  <div>
                    <h2>Price Chart</h2>
                    <p>1-minute price action for the last hour, including the latest live quote.</p>
                  </div>
                </div>
                {refreshState.warning ? (
                  <p className="details-refresh-warning">Refresh issue: {refreshState.warning}</p>
                ) : null}
                {candles.length === 0 && !quote ? (
                  <div className="details-panel-state">
                    <EmptyState
                      message="No quote or candle data is available for LITE yet."
                      title="Latest data unavailable"
                    />
                  </div>
                ) : (
                  <PriceLineChart candles={candles} feed={marketFeed} quote={quote} />
                )}
              </MarketDataBoundary>
            </article>

            <article className="panel details-position-panel">
              <div className="panel-header">
                <div>
                  <h2>Position Summary</h2>
                  <p>Latest current-position snapshot for LITE.</p>
                </div>
              </div>
              {position ? (
                <div className="details-position-list">
                  <div>
                    <span>Quantity</span>
                    <strong>{formatNumber(position.total_quantity, 4)}</strong>
                  </div>
                  <div>
                    <span>Avg cost</span>
                    <strong>{formatCurrency(position.avg_cost)}</strong>
                  </div>
                  <div>
                    <span>Market value</span>
                    <strong>{formatCurrency(position.market_value)}</strong>
                  </div>
                  <div>
                    <span>Unrealized P&L</span>
                    <strong className={pnlClass(position.unrealized_pnl)}>
                      {formatSignedCurrency(position.unrealized_pnl)}
                    </strong>
                  </div>
                </div>
              ) : (
                <div className="details-panel-state">
                  <EmptyState message="No current position." />
                </div>
              )}
            </article>
          </section>

          <section className="details-lots-section">
            <LotsView embedded symbol={PILOT_SYMBOL} />
          </section>
        </>
      )}
    </>
  );
}
