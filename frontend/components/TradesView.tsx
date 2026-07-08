"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { HandDrawnDivider } from "@/components/HandDrawnDivider";
import { LoadingState } from "@/components/LoadingState";
import { api, type DecimalValue, type Trade } from "@/lib/api";
import { formatDisplayDate, formatDisplayTime } from "@/lib/format";

type TradePreset = "7d" | "30d" | "90d" | "ytd" | "all" | "custom";
type SideFilter = "ALL" | "BUY" | "SELL";

type TradeFilters = {
  symbol: string;
  side: SideFilter;
  preset: TradePreset;
  startDate: string;
  endDate: string;
};

const PRESET_LABELS: Record<TradePreset, string> = {
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  "90d": "Last 90 Days",
  ytd: "This Year",
  all: "All Time",
  custom: "Custom Range",
};

const SIDE_LABELS: Record<SideFilter, string> = {
  ALL: "All",
  BUY: "Buys",
  SELL: "Sells",
};

// Real trade rows pulled from production (STK asset class, FX-conversion rows
// excluded — same shape the /trades endpoint returns) so local preview without
// a backend still renders the account's actual recent activity.
const DEMO_REFERENCE_DATE = new Date("2026-06-05T00:00:00");

// Timeline lazy-loads a viewport-sized batch of rows, revealing another batch
// each time the user scrolls the sentinel near the bottom into view.
const TIMELINE_PAGE_SIZE = 8;

function demoTrade(overrides: Partial<Trade> & Pick<Trade, "symbol">): Trade {
  return {
    report_date: null,
    account_id: null,
    currency: "USD",
    asset_class: "STK",
    description: null,
    conid: null,
    datetime: null,
    trade_date: null,
    settle_date: null,
    transaction_type: "ExchTrade",
    exchange: "NASDAQ",
    quantity: null,
    trade_price: null,
    trade_money: null,
    proceeds: null,
    taxes: null,
    ib_commission: null,
    ib_commission_currency: "USD",
    net_cash: null,
    open_close_indicator: null,
    cost_basis: null,
    realized_pnl: null,
    mtm_pnl: null,
    buy_sell: null,
    order_id: null,
    transaction_id: null,
    ib_execution_id: null,
    ib_order_id: null,
    orig_order_id: null,
    orig_trade_price: null,
    orig_trade_date: null,
    orig_trade_id: null,
    open_datetime: null,
    level_of_detail: null,
    ...overrides,
  };
}

const DEMO_TRADES: Trade[] = [
  demoTrade({
    symbol: "MU",
    description: "MICRON TECHNOLOGY INC",
    transaction_id: "demo-mu-1",
    trade_date: "2026-06-05",
    datetime: "2026-06-05T14:15:41+00:00",
    buy_sell: "BUY",
    quantity: 0.056,
    trade_price: 889.98,
    trade_money: 49.8388800000,
    ib_commission: -0.3502686180,
    net_cash: -50.1891486180,
    realized_pnl: 0,
    open_close_indicator: "O",
  }),
  demoTrade({
    symbol: "MU",
    description: "MICRON TECHNOLOGY INC",
    transaction_id: "demo-mu-2",
    trade_date: "2026-06-05",
    datetime: "2026-06-05T12:18:27+00:00",
    buy_sell: "BUY",
    quantity: 0.055,
    trade_price: 914.97,
    trade_money: 50.3233500000,
    ib_commission: -0.3502684150,
    net_cash: -50.6736184150,
    realized_pnl: 0,
    open_close_indicator: "O",
  }),
  demoTrade({
    symbol: "LITE",
    description: "LUMENTUM HOLDINGS INC",
    transaction_id: "demo-lite-1",
    trade_date: "2026-05-28",
    datetime: "2026-05-28T14:53:50+00:00",
    buy_sell: "BUY",
    quantity: 0.116,
    trade_price: 859.50,
    trade_money: 99.7020000000,
    ib_commission: -0.3502807980,
    net_cash: -100.0522807980,
    realized_pnl: 0,
    open_close_indicator: "O",
  }),
  demoTrade({
    symbol: "SNDK",
    description: "SANDISK CORP",
    transaction_id: "demo-sndk-1",
    trade_date: "2026-05-26",
    datetime: "2026-05-26T13:32:09+00:00",
    buy_sell: "SELL",
    quantity: -0.072,
    trade_price: 1605.00,
    trade_money: -115.5600000000,
    ib_commission: -0.3526664420,
    net_cash: 115.2073335580,
    realized_pnl: 14.8483420000,
    open_close_indicator: "C",
  }),
  demoTrade({
    symbol: "TSLA",
    description: "TESLA INC",
    transaction_id: "demo-tsla-1",
    trade_date: "2026-05-26",
    datetime: "2026-05-26T11:24:43+00:00",
    buy_sell: "SELL",
    quantity: -0.02,
    trade_price: 434.00,
    trade_money: -8.6800000000,
    ib_commission: -0.0870505660,
    net_cash: 8.5929494340,
    realized_pnl: 1.0380900000,
    open_close_indicator: "C",
  }),
  demoTrade({
    symbol: "IREN",
    description: "IREN LTD",
    transaction_id: "demo-iren-1",
    trade_date: "2026-05-26",
    datetime: "2026-05-26T09:42:26+00:00",
    buy_sell: "SELL",
    quantity: -1.00,
    trade_price: 60.07,
    trade_money: -60.0700000000,
    ib_commission: -0.3518926920,
    net_cash: 59.7181073080,
    realized_pnl: 4.5689470000,
    open_close_indicator: "C",
  }),
  demoTrade({
    symbol: "SNDK",
    description: "SANDISK CORP",
    transaction_id: "demo-sndk-2",
    trade_date: "2026-05-26",
    datetime: "2026-05-26T09:37:01+00:00",
    buy_sell: "SELL",
    quantity: -0.14,
    trade_price: 1560.71,
    trade_money: -218.4994000000,
    ib_commission: -0.3548140580,
    net_cash: 218.1445859420,
    realized_pnl: 16.6154440000,
    open_close_indicator: "C",
  }),
];

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computePresetRange(preset: Exclude<TradePreset, "custom">, reference: Date): { startDate: string; endDate: string } {
  const endDate = formatDateInput(reference);
  if (preset === "all") {
    return { startDate: "", endDate };
  }
  if (preset === "ytd") {
    const start = new Date(reference.getFullYear(), 0, 1);
    return { startDate: formatDateInput(start), endDate };
  }
  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  const start = new Date(reference);
  start.setDate(start.getDate() - days);
  return { startDate: formatDateInput(start), endDate };
}

function getDefaultFilters(): TradeFilters {
  const range = computePresetRange("30d", new Date());
  return { symbol: "", side: "ALL", preset: "30d", startDate: range.startDate, endDate: range.endDate };
}

function filterDemoTradesByRange(startDate: string, endDate: string): Trade[] {
  return DEMO_TRADES.filter((trade) => {
    if (!trade.trade_date) {
      return false;
    }
    if (startDate && trade.trade_date < startDate) {
      return false;
    }
    if (endDate && trade.trade_date > endDate) {
      return false;
    }
    return true;
  });
}

function decimalNumber(value: DecimalValue): number | null {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function absDecimal(value: DecimalValue): DecimalValue {
  const number = decimalNumber(value);
  return number === null ? null : Math.abs(number);
}

function formatNumber(value: DecimalValue, maximumFractionDigits = 2): string {
  const number = decimalNumber(value);
  return number === null
    ? "--"
    : number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits });
}

function formatMoney(value: DecimalValue, currency: string | null): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }
  if (!currency) {
    return formatNumber(value);
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function pnlClass(value: DecimalValue): string {
  const number = decimalNumber(value);
  return number === null || number === 0 ? "" : number > 0 ? "pnl-positive" : "pnl-negative";
}

function formatCompanyName(value: string | null): string {
  if (!value) {
    return "";
  }
  return value
    .toLowerCase()
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function isBuyTrade(trade: Trade): boolean {
  return trade.buy_sell?.toUpperCase() === "BUY";
}

function rowKey(trade: Trade, index: number): string {
  return trade.transaction_id ?? trade.ib_execution_id ?? `${trade.symbol ?? "row"}-${trade.datetime ?? index}-${index}`;
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.3" viewBox="0 0 24 24" width="14">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function TradesView() {
  const [filters, setFilters] = useState<TradeFilters>(() => getDefaultFilters());
  const [dateScopedTrades, setDateScopedTrades] = useState<Trade[] | null>(null);
  const [latestTrade, setLatestTrade] = useState<Trade | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    api.trades({ limit: 1 })
      .then((result) => {
        if (active) {
          setLatestTrade(result.items[0] ?? null);
        }
      })
      .catch(() => {
        if (active) {
          setLatestTrade(DEMO_TRADES[0] ?? null);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const timeoutId = window.setTimeout(() => {
      if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
        setError("Start date must not be after end date.");
        setIsLoading(false);
        return;
      }

      setError(null);

      if (isDemo) {
        setDateScopedTrades(filterDemoTradesByRange(filters.startDate, filters.endDate));
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      api.trades({ start_date: filters.startDate || undefined, end_date: filters.endDate || undefined })
        .then((result) => {
          if (active) {
            setDateScopedTrades(result.items);
          }
        })
        .catch((requestError: unknown) => {
          if (!active) {
            return;
          }
          console.warn("Trades API unavailable, using demo data:", requestError);
          const demoPreset = filters.preset === "custom" ? "30d" : filters.preset;
          const demoRange = computePresetRange(demoPreset, DEMO_REFERENCE_DATE);
          setIsDemo(true);
          setFilters((current) => ({ ...current, startDate: demoRange.startDate, endDate: demoRange.endDate }));
          setDateScopedTrades(filterDemoTradesByRange(demoRange.startDate, demoRange.endDate));
        })
        .finally(() => {
          if (active) {
            setIsLoading(false);
          }
        });
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [filters.startDate, filters.endDate, isDemo]);

  const symbolOptions = useMemo(() => {
    const symbols = new Set<string>();
    (dateScopedTrades ?? []).forEach((trade) => {
      if (trade.symbol) {
        symbols.add(trade.symbol);
      }
    });
    return Array.from(symbols).sort();
  }, [dateScopedTrades]);

  const filteredTrades = useMemo(() => {
    return (dateScopedTrades ?? []).filter((trade) => {
      if (filters.symbol && trade.symbol !== filters.symbol) {
        return false;
      }
      if (filters.side !== "ALL" && trade.buy_sell?.toUpperCase() !== filters.side) {
        return false;
      }
      return true;
    });
  }, [dateScopedTrades, filters.symbol, filters.side]);

  const stats = useMemo(() => {
    const buy = filteredTrades.filter((trade) => isBuyTrade(trade)).length;
    const sell = filteredTrades.filter((trade) => trade.buy_sell?.toUpperCase() === "SELL").length;
    const symbols = new Set(filteredTrades.map((trade) => trade.symbol).filter(Boolean)).size;
    return { total: filteredTrades.length, buy, sell, symbols };
  }, [filteredTrades]);

  const [visibleCount, setVisibleCount] = useState(TIMELINE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLLIElement | null>(null);

  // Reset the reveal window whenever the filtered result set changes so a new
  // filter always starts from the first batch.
  useEffect(() => {
    setVisibleCount(TIMELINE_PAGE_SIZE);
  }, [filteredTrades]);

  const visibleTrades = filteredTrades.slice(0, visibleCount);
  const hasMore = visibleCount < filteredTrades.length;

  // Reveal the next batch as the sentinel nears the bottom of the viewport.
  // Runs once immediately so short lists fill the viewport, then on scroll.
  useEffect(() => {
    if (!hasMore) {
      return;
    }
    const revealIfNear = () => {
      const sentinel = sentinelRef.current;
      if (!sentinel) {
        return;
      }
      if (sentinel.getBoundingClientRect().top <= window.innerHeight + 160) {
        setVisibleCount((current) => Math.min(current + TIMELINE_PAGE_SIZE, filteredTrades.length));
      }
    };
    revealIfNear();
    window.addEventListener("scroll", revealIfNear, { passive: true });
    window.addEventListener("resize", revealIfNear);
    return () => {
      window.removeEventListener("scroll", revealIfNear);
      window.removeEventListener("resize", revealIfNear);
    };
  }, [hasMore, visibleCount, filteredTrades.length]);

  const allExpanded =
    filteredTrades.length > 0 && filteredTrades.every((trade, index) => expandedIds.has(rowKey(trade, index)));

  function toggleRow(key: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleExpandAll() {
    if (allExpanded) {
      setExpandedIds(new Set());
      return;
    }
    setExpandedIds(new Set(filteredTrades.map((trade, index) => rowKey(trade, index))));
  }

  function handlePresetChange(nextPreset: TradePreset) {
    if (nextPreset === "custom") {
      setFilters((current) => ({ ...current, preset: "custom" }));
      setAdvancedOpen(true);
      return;
    }
    const range = computePresetRange(nextPreset, isDemo ? DEMO_REFERENCE_DATE : new Date());
    setFilters((current) => ({ ...current, preset: nextPreset, startDate: range.startDate, endDate: range.endDate }));
  }

  function handleDateInput(field: "startDate" | "endDate", value: string) {
    setFilters((current) => ({ ...current, [field]: value, preset: "custom" }));
  }

  function resetFilters() {
    const range = computePresetRange("30d", isDemo ? DEMO_REFERENCE_DATE : new Date());
    setFilters({ symbol: "", side: "ALL", preset: "30d", startDate: range.startDate, endDate: range.endDate });
    setAdvancedOpen(false);
    setError(null);
  }

  const latestIsBuy = latestTrade ? isBuyTrade(latestTrade) : true;

  return (
    <>
      <div className="page-header trades-hero-header">
        <div className="trades-hero-copy">
          <p className="eyebrow">Activity</p>
          <h1>Trades</h1>
          <p className="page-description">
            A complete history of your investment decisions. Imported automatically from Interactive Brokers.
          </p>
          <HandDrawnDivider className="trades-hero-divider" />
        </div>
        {latestTrade ? (
          <div className="trades-latest-card">
            <div className="trades-latest-head">
              <span className="trades-latest-label">Latest Trade</span>
              <span className="trades-latest-date">{formatDisplayDate(latestTrade.trade_date)}</span>
            </div>
            <p className="trades-latest-title">
              {latestIsBuy ? "Buy" : "Sell"} {latestTrade.symbol ?? "--"}
            </p>
            <p className="trades-latest-shares">{formatNumber(latestTrade.quantity, 4)} shares</p>
            <div className="trades-latest-foot">
              <div>
                <p className="trades-latest-value-label">Trade value</p>
                <p className="trades-latest-value">{formatMoney(absDecimal(latestTrade.trade_money), latestTrade.currency)}</p>
              </div>
              <svg
                aria-hidden="true"
                className={`trades-latest-spark${latestIsBuy ? "" : " is-sell"}`}
                preserveAspectRatio="none"
                viewBox="0 0 120 46"
              >
                <polyline
                  fill="none"
                  points="2,34 18,30 34,36 50,24 66,28 82,14 98,18 118,6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.4"
                />
                <circle cx="118" cy="6" r="3.4" />
              </svg>
            </div>
          </div>
        ) : null}
      </div>

      <section className="trades-overview-row">
        <div className="trades-stat-cards">
          <article className="trades-stat-card trades-stat-card-merged">
            <div className="trades-stat-block">
              <p className="trades-stat-value">{stats.total}</p>
              <p className="trades-stat-label">Trades</p>
              <p className="trades-stat-hint">{PRESET_LABELS[filters.preset]}</p>
            </div>
            <span className="trades-stat-divider" aria-hidden="true" />
            <div className="trades-stat-block trades-stat-buy-sell">
              <div className="trades-stat-split-col">
                <p className="trades-stat-value">{stats.buy}</p>
                <p className="trades-stat-label trades-stat-label-buy">Buys</p>
              </div>
              <div className="trades-stat-split-col">
                <p className="trades-stat-value">{stats.sell}</p>
                <p className="trades-stat-label trades-stat-label-sell">Sells</p>
              </div>
            </div>
          </article>
          <article className="trades-stat-card">
            <p className="trades-stat-value">{stats.symbols}</p>
            <p className="trades-stat-label">Symbols</p>
            <p className="trades-stat-hint">Traded</p>
          </article>
        </div>

        <div className="trades-filter-controls">
          <p className="trades-filter-title">Show trades from</p>
          <div className="trades-filter-row">
            <label className="trades-dropdown">
              <select
                onChange={(event) => handlePresetChange(event.target.value as TradePreset)}
                value={filters.preset}
              >
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="90d">Last 90 Days</option>
                <option value="ytd">This Year</option>
                <option value="all">All Time</option>
                {filters.preset === "custom" ? <option value="custom">Custom Range</option> : null}
              </select>
              <ChevronIcon className="trades-dropdown-chevron" />
            </label>
            <label className="trades-dropdown">
              <select
                onChange={(event) => setFilters((current) => ({ ...current, symbol: event.target.value }))}
                value={filters.symbol}
              >
                <option value="">All Symbols</option>
                {symbolOptions.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
              <ChevronIcon className="trades-dropdown-chevron" />
            </label>
          </div>
          <button
            aria-expanded={advancedOpen}
            className="trades-dropdown trades-advanced-toggle"
            onClick={() => setAdvancedOpen((current) => !current)}
            type="button"
          >
            <span>Advanced Filters</span>
            <ChevronIcon className={`trades-dropdown-chevron${advancedOpen ? " is-open" : ""}`} />
          </button>
          {advancedOpen ? (
            <div className="trades-advanced-panel">
              <div className="trades-side-toggle" role="group" aria-label="Trade side">
                {(["ALL", "BUY", "SELL"] as SideFilter[]).map((side) => (
                  <button
                    className={`trades-side-btn${filters.side === side ? " is-active" : ""}`}
                    key={side}
                    onClick={() => setFilters((current) => ({ ...current, side }))}
                    type="button"
                  >
                    {SIDE_LABELS[side]}
                  </button>
                ))}
              </div>
              <div className="trades-advanced-dates">
                <label className="filter-field">
                  <span>Start date</span>
                  <input
                    onChange={(event) => handleDateInput("startDate", event.target.value)}
                    type="date"
                    value={filters.startDate}
                  />
                </label>
                <label className="filter-field">
                  <span>End date</span>
                  <input
                    onChange={(event) => handleDateInput("endDate", event.target.value)}
                    type="date"
                    value={filters.endDate}
                  />
                </label>
              </div>
              <button className="secondary-button trades-reset-button" onClick={resetFilters} type="button">
                Reset filters
              </button>
            </div>
          ) : null}
          {error ? <ErrorState message={error} title="Unable to load trades" /> : null}
        </div>
      </section>

      <section className="panel trades-timeline-panel">
        <div className="panel-header">
          <div>
            <h2>Trade Timeline</h2>
          </div>
          <button className="secondary-button trades-expand-all" onClick={toggleExpandAll} type="button">
            {allExpanded ? "Collapse all" : "Expand all"}
            <ChevronIcon className={`trades-dropdown-chevron${allExpanded ? " is-open" : ""}`} />
          </button>
        </div>

        {isLoading ? (
          <div className="panel-state">
            <LoadingState message="Loading trade history..." />
          </div>
        ) : filteredTrades.length === 0 ? (
          <div className="panel-state">
            <EmptyState message="No trades match the selected filters." />
          </div>
        ) : (
          <ol className="trades-timeline">
            {visibleTrades.map((trade, index) => {
              const key = rowKey(trade, index);
              const expanded = expandedIds.has(key);
              const buy = isBuyTrade(trade);

              return (
                <li className="trades-timeline-row" key={key}>
                  <div className="trades-timeline-when">
                    <span className="trades-timeline-date">{formatDisplayDate(trade.trade_date)}</span>
                    <span className="trades-timeline-time">{formatDisplayTime(trade.datetime)}</span>
                  </div>
                  <div className="trades-timeline-dot-col">
                    <span className={`trades-timeline-dot${buy ? " is-buy" : " is-sell"}`} aria-hidden="true" />
                  </div>
                  <div className={`trades-timeline-card${expanded ? " is-expanded" : ""}`}>
                    <button
                      aria-expanded={expanded}
                      className="trades-timeline-summary"
                      onClick={() => toggleRow(key)}
                      type="button"
                    >
                      <span className={`trades-side-badge${buy ? " is-buy" : " is-sell"}`}>
                        {trade.buy_sell?.toUpperCase() ?? "--"}
                      </span>
                      <span className="trades-timeline-symbol">
                        <strong>{trade.symbol ?? "--"}</strong>
                        <span className="trades-timeline-desc">{formatCompanyName(trade.description)}</span>
                      </span>
                      <span className="trades-timeline-qty">
                        <span>{formatNumber(trade.quantity, 4)} shares</span>
                        <span className="trades-timeline-price">@ {formatMoney(trade.trade_price, trade.currency)}</span>
                      </span>
                      <span className="trades-timeline-value">
                        <span className="trades-timeline-value-label">Trade value</span>
                        <strong>{formatMoney(absDecimal(trade.trade_money), trade.currency)}</strong>
                      </span>
                      <ChevronIcon className={`trades-timeline-chevron${expanded ? " is-open" : ""}`} />
                    </button>
                    {expanded ? (
                      <div className="trades-timeline-detail">
                        <div className="trades-timeline-detail-item">
                          <span>Commission</span>
                          <strong>{formatMoney(trade.ib_commission, trade.ib_commission_currency ?? trade.currency)}</strong>
                        </div>
                        <div className="trades-timeline-detail-item">
                          <span>Net cash</span>
                          <strong>{formatMoney(trade.net_cash, trade.currency)}</strong>
                        </div>
                        <div className="trades-timeline-detail-item">
                          <span>Realized P&amp;L</span>
                          <strong className={pnlClass(trade.realized_pnl)}>
                            {formatMoney(trade.realized_pnl, trade.currency)}
                          </strong>
                        </div>
                        <div className="trades-timeline-detail-item">
                          <span>Exchange</span>
                          <strong>{trade.exchange ?? "--"}</strong>
                        </div>
                        <div className="trades-timeline-detail-item">
                          <span>Open/Close</span>
                          <strong>{trade.open_close_indicator === "O" ? "Open" : trade.open_close_indicator === "C" ? "Close" : "--"}</strong>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
            {hasMore ? (
              <li className="trades-timeline-sentinel" ref={sentinelRef} aria-hidden="true">
                <span className="trades-timeline-loading">Loading more trades…</span>
              </li>
            ) : null}
          </ol>
        )}
        {!isLoading && filteredTrades.length > 0 && !hasMore ? (
          <p className="trades-timeline-end">You&apos;ve reached the end of your trade history.</p>
        ) : null}
      </section>

      <div className="trades-footnote">
        <span>All times shown in your local timezone</span>
        <span className="trades-footnote-source">
          Data provided by
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="Interactive Brokers" className="trades-footnote-logo" src="/Interactive_Brokers_Logo_(2014).svg" />
        </span>
      </div>
    </>
  );
}
