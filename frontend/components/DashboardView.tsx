"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { NavHistoryChart } from "@/components/NavHistoryChart";
import { PerformanceCalendar } from "@/components/PerformanceCalendar";
import { RealizedPnlChart } from "@/components/RealizedPnlChart";
import {
  api,
  type CashActivity,
  type NavDaily,
  type PortfolioPerformanceDaily,
  type PortfolioSummary,
  type RealizedPnlDaily,
  type RealizedPnlSummary,
  type Trade,
} from "@/lib/api";
import { DASHBOARD_DEMO } from "@/lib/dashboardDemo";
import { formatDisplayDate } from "@/lib/format";

type DashboardData = {
  summary: PortfolioSummary | null;
  navHistory: NavDaily[];
  performanceDaily: PortfolioPerformanceDaily[];
  realizedSummary: RealizedPnlSummary;
  realizedDaily: RealizedPnlDaily[];
  trades: Trade[];
  activities: CashActivity[];
};

type RangeKey = "7D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "All";

const RANGES: RangeKey[] = ["7D", "1M", "3M", "6M", "YTD", "1Y", "All"];

type ActivityItem = {
  key: string;
  date: string;
  label: string;
  symbol: string | null;
  amount: number | null;
  currency: string | null;
};

function decimalNumber(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function displayCurrency(currency: string | null): string {
  return !currency || currency === "MULTI" ? "USD" : currency;
}

function formatMoney(value: number | string | null, currency: string | null): string {
  const number = decimalNumber(value);

  if (number === null) {
    return "--";
  }

  if (!currency || currency === "MULTI") {
    return number.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function formatSignedMoney(value: number | null, currency: string | null): string {
  if (value === null) {
    return "--";
  }

  const formatted = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: displayCurrency(currency),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));

  if (value > 0) {
    return `+${formatted}`;
  }
  if (value < 0) {
    return `-${formatted}`;
  }
  return formatted;
}

function dateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recentThirtyDayRange(): { start_date: string; end_date: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 29);

  return {
    start_date: dateInputValue(start),
    end_date: dateInputValue(end),
  };
}

function rangeStartValue(key: RangeKey, end = new Date()): string | null {
  if (key === "All") {
    return null;
  }

  const start = new Date(end);
  switch (key) {
    case "7D":
      start.setDate(end.getDate() - 7);
      break;
    case "1M":
      start.setMonth(end.getMonth() - 1);
      break;
    case "3M":
      start.setMonth(end.getMonth() - 3);
      break;
    case "6M":
      start.setMonth(end.getMonth() - 6);
      break;
    case "YTD":
      return dateInputValue(new Date(end.getFullYear(), 0, 1));
    case "1Y":
      start.setFullYear(end.getFullYear() - 1);
      break;
  }
  return dateInputValue(start);
}

function filterByDate<T>(items: T[], getDate: (item: T) => string | null, key: RangeKey): T[] {
  const start = rangeStartValue(key);
  if (!start) {
    return items;
  }
  return items.filter((item) => {
    const date = getDate(item);
    return date !== null && date >= start;
  });
}

function formatRangeLabel(start: string, end: string): string {
  const startLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(`${start}T00:00:00`),
  );
  const endLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${end}T00:00:00`));
  return `${startLabel} – ${endLabel}`;
}

function navChange(navHistory: NavDaily[]): { amount: number; pct: number | null; date: string } | null {
  const points = navHistory
    .filter((item): item is NavDaily & { report_date: string } => item.report_date !== null)
    .map((item) => ({ date: item.report_date, total: decimalNumber(item.total) }))
    .filter((item): item is { date: string; total: number } => item.total !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length < 2) {
    return null;
  }

  const last = points[points.length - 1];
  const previous = points[points.length - 2];
  const amount = last.total - previous.total;
  const pct = previous.total !== 0 ? amount / previous.total : null;
  return { amount, pct, date: last.date };
}

function buildActivity(trades: Trade[], activities: CashActivity[]): ActivityItem[] {
  const fromTrades: ActivityItem[] = trades.map((trade, index) => {
    const quantity = decimalNumber(trade.quantity) ?? 0;
    const isSell = (trade.buy_sell ?? "").toUpperCase() === "SELL" || quantity < 0;
    const shares = Math.abs(quantity);
    return {
      key: `trade-${trade.transaction_id ?? index}`,
      date: trade.trade_date ?? trade.report_date ?? "",
      label: `${isSell ? "Sold" : "Bought"} ${shares.toLocaleString()} shares`,
      symbol: trade.symbol,
      amount: decimalNumber(trade.net_cash),
      currency: trade.currency,
    };
  });

  const fromActivities: ActivityItem[] = activities.map((activity) => ({
    key: `cash-${activity.id}`,
    date: activity.activity_date ?? activity.report_date ?? "",
    label: activity.description || activity.activity_type || "Activity",
    symbol: activity.symbol,
    amount: decimalNumber(activity.amount),
    currency: activity.currency,
  }));

  return [...fromTrades, ...fromActivities]
    .filter((item) => item.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9.4 9.2a2.6 2.6 0 0 1 5 1c0 1.7-2.4 2-2.4 3.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4 1.2 5.3 1.8 6H4.7c.6-.7 1.8-2 1.8-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M4 15l4.5-5 3.5 3L20 7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M15 7h5v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="3.5" y="6" width="17" height="13" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 10h17" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16.5" cy="14" r="1.1" fill="currentColor" />
    </svg>
  );
}

function PieIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M12 3.5A8.5 8.5 0 1 0 20.5 12H12V3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13.5 3.6A8.5 8.5 0 0 1 20.4 10.5H13.5V3.6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowUp() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
      <path d="M12 19V6m0 0-5 5m5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
      <path d="M12 5v13m0 0 5-5m-5 5-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type AllocationSlice = {
  key: string;
  label: string;
  value: number;
  pct: number;
  className: string;
};

function AllocationDonut({ slices }: { slices: AllocationSlice[] }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const visible = slices.filter((slice) => slice.pct > 0);

  return (
    <svg className="dash-donut" viewBox="0 0 110 110" role="img" aria-label="Asset allocation donut chart">
      <circle cx="55" cy="55" r={radius} className="dash-donut-track" fill="none" strokeWidth="11" />
      {visible.map((slice) => {
        const length = (slice.pct / 100) * circumference;
        const dash = `${length} ${circumference - length}`;
        const segment = (
          <circle
            key={slice.key}
            cx="55"
            cy="55"
            r={radius}
            className={`dash-donut-seg dash-donut-${slice.className}`}
            fill="none"
            strokeWidth="11"
            strokeDasharray={dash}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
            transform="rotate(-90 55 55)"
          />
        );
        offset += length;
        return segment;
      })}
    </svg>
  );
}

export function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [navRange, setNavRange] = useState<RangeKey>("1M");
  const [pnlRange, setPnlRange] = useState<RangeKey>("1M");

  useEffect(() => {
    let active = true;

    const isDemo =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("demo") !== null;

    if (isDemo) {
      setData(DASHBOARD_DEMO);
      return () => {
        active = false;
      };
    }

    const yearRange = { start_date: rangeStartValue("1Y") ?? undefined };

    Promise.all([
      api.portfolioSummary(),
      api.navHistory(),
      api.portfolioPerformanceDaily(recentThirtyDayRange()),
      api.realizedPnlSummary(),
      api.realizedPnlDaily(yearRange),
      api.trades({ limit: 8 }).catch(() => null),
      api.cashActivities(recentThirtyDayRange()).catch(() => null),
    ])
      .then(([summary, navHistory, performanceDaily, realizedSummary, realizedDaily, trades, activities]) => {
        if (active) {
          setData({
            summary,
            navHistory,
            performanceDaily,
            realizedSummary,
            realizedDaily,
            trades: trades?.items ?? [],
            activities: activities?.items ?? [],
          });
        }
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : "Request failed.");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const rangeLabel = useMemo(() => {
    const range = recentThirtyDayRange();
    return formatRangeLabel(range.start_date, range.end_date);
  }, []);

  const change = useMemo(() => (data ? navChange(data.navHistory) : null), [data]);

  const navPoints = useMemo(
    () => (data ? filterByDate(data.navHistory, (item) => item.report_date, navRange) : []),
    [data, navRange],
  );

  const pnlPoints = useMemo(
    () => (data ? filterByDate(data.realizedDaily, (item) => item.date, pnlRange) : []),
    [data, pnlRange],
  );

  const activity = useMemo(
    () => (data ? buildActivity(data.trades, data.activities) : []),
    [data],
  );

  if (error) {
    return (
      <section className="dashboard-state">
        <ErrorState message={error} title="Unable to load dashboard" />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="dashboard-state">
        <LoadingState message="Loading your portfolio summary and NAV history..." />
      </section>
    );
  }

  if (!data.summary) {
    return (
      <section className="dashboard-state">
        <EmptyState
          title="Your dashboard is ready"
          message="No portfolio report is available yet. Run a sync to begin tracking your assets."
        />
      </section>
    );
  }

  const { summary, performanceDaily, realizedSummary } = data;
  const realizedPnl = decimalNumber(realizedSummary.total_realized_pnl);
  const realizedPnlTone = realizedPnl !== null && realizedPnl < 0 ? "negative" : "positive";
  const realizedCurrency = realizedSummary.currency ?? summary.currency;

  const stockValue = decimalNumber(summary.stock) ?? 0;
  const cashValue = decimalNumber(summary.cash) ?? 0;
  const totalNav = decimalNumber(summary.total_nav) ?? stockValue + cashValue;
  const otherValue = Math.max(0, totalNav - stockValue - cashValue);
  const allocationTotal = stockValue + cashValue + otherValue;
  const pct = (value: number) => (allocationTotal > 0 ? (value / allocationTotal) * 100 : 0);
  const allocationSlices: AllocationSlice[] = [
    { key: "stocks", label: "Stocks", value: stockValue, pct: pct(stockValue), className: "stocks" },
    { key: "cash", label: "Cash", value: cashValue, pct: pct(cashValue), className: "cash" },
    { key: "other", label: "Other", value: otherValue, pct: pct(otherValue), className: "other" },
  ];

  return (
    <div className="dashboard-page">
      <div className="dash-toolbar">
        <div className="dash-toolbar-actions">
          <button className="dash-icon-btn" type="button" aria-label="Help">
            <HelpIcon />
          </button>
          <button className="dash-icon-btn" type="button" aria-label="Notifications">
            <BellIcon />
          </button>
        </div>
        <button className="dash-daterange" type="button">
          <CalendarIcon />
          <span>{rangeLabel}</span>
          <ChevronDown />
        </button>
      </div>

      <section aria-label="Daily performance">
        <PerformanceCalendar
          currency={summary.currency}
          days={performanceDaily}
          rangeLabel={rangeLabel}
        />
      </section>

      <section className="dash-charts" aria-label="Portfolio charts">
        <article className="dash-panel">
          <header className="dash-panel-head">
            <div>
              <h2 className="dash-panel-title">NAV history</h2>
              <p className="dash-panel-sub">Total net asset value over time</p>
            </div>
            {summary.currency ? <span className="dash-ccy">{summary.currency}</span> : null}
          </header>
          {navPoints.length === 0 ? (
            <EmptyState message="NAV history will appear after reports have been imported." />
          ) : (
            <NavHistoryChart currency={summary.currency} history={navPoints} />
          )}
          <div className="dash-range-tabs" role="tablist" aria-label="NAV history range">
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                role="tab"
                aria-selected={navRange === range}
                className={`dash-range-tab${navRange === range ? " is-active" : ""}`}
                onClick={() => setNavRange(range)}
              >
                {range}
              </button>
            ))}
          </div>
        </article>

        <article className="dash-panel">
          <header className="dash-panel-head">
            <div>
              <h2 className="dash-panel-title">Realized P/L</h2>
              <p className="dash-panel-sub">Closed lot performance</p>
            </div>
            {realizedCurrency ? <span className="dash-ccy">{realizedCurrency}</span> : null}
          </header>
          {pnlPoints.length === 0 ? (
            <EmptyState message="Recent realized P/L will appear after closed lots are imported." />
          ) : (
            <RealizedPnlChart currency={realizedCurrency} history={pnlPoints} />
          )}
          <div className="dash-range-tabs" role="tablist" aria-label="Realized P/L range">
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                role="tab"
                aria-selected={pnlRange === range}
                className={`dash-range-tab${pnlRange === range ? " is-active" : ""}`}
                onClick={() => setPnlRange(range)}
              >
                {range}
              </button>
            ))}
          </div>
        </article>
      </section>

      <section className="dash-stats" aria-label="Portfolio statistics">
        <article className="dash-stat dash-stat-feature">
          <div className="dash-stat-main">
            <p className="dash-stat-label">Total NAV</p>
            <p className="dash-stat-value">{formatMoney(summary.total_nav, summary.currency)}</p>
            {change ? (
              <p className={`dash-stat-change dash-stat-change-${change.amount < 0 ? "down" : "up"}`}>
                {change.amount < 0 ? <ArrowDown /> : <ArrowUp />}
                <span>
                  {formatSignedMoney(change.amount, summary.currency)}
                  {change.pct !== null
                    ? ` (${change.pct >= 0 ? "+" : ""}${(change.pct * 100).toFixed(2)}%)`
                    : ""}
                </span>
              </p>
            ) : null}
            <p className="dash-stat-hint">{formatDisplayDate(summary.report_date)}</p>
          </div>
          <span className="dash-stat-icon">
            <TrendIcon />
          </span>
        </article>

        <article className="dash-stat">
          <div className="dash-stat-main">
            <p className="dash-stat-label">Cash</p>
            <p className="dash-stat-value">{formatMoney(summary.cash, summary.currency)}</p>
            <p className="dash-stat-hint">Available balance</p>
          </div>
          <span className="dash-stat-icon">
            <WalletIcon />
          </span>
        </article>

        <article className="dash-stat">
          <div className="dash-stat-main">
            <p className="dash-stat-label">Stock Value</p>
            <p className="dash-stat-value">{formatMoney(summary.stock, summary.currency)}</p>
            <p className="dash-stat-hint">Market value</p>
          </div>
          <span className="dash-stat-icon">
            <PieIcon />
          </span>
        </article>

        <article className="dash-stat">
          <div className="dash-stat-main">
            <p className="dash-stat-label">Realized P/L</p>
            <p className={`dash-stat-value dash-stat-value-${realizedPnlTone}`}>
              {formatMoney(realizedSummary.total_realized_pnl, realizedCurrency)}
            </p>
            <p className="dash-stat-hint">
              {realizedSummary.start_date && realizedSummary.end_date
                ? `${formatDisplayDate(realizedSummary.start_date)} – ${formatDisplayDate(realizedSummary.end_date)}`
                : "Closed lots"}
            </p>
          </div>
          <span className="dash-stat-icon">
            <TrendIcon />
          </span>
        </article>
      </section>

      <section className="dash-bottom" aria-label="Activity and allocation">
        <article className="dash-panel dash-activity">
          <header className="dash-panel-head">
            <h2 className="dash-panel-title">Recent activity</h2>
          </header>
          {activity.length === 0 ? (
            <EmptyState message="Recent trades and cash activity will appear here." />
          ) : (
            <ul className="dash-activity-list">
              {activity.map((item) => {
                const tone = item.amount === null ? "neutral" : item.amount < 0 ? "down" : "up";
                return (
                  <li className="dash-activity-row" key={item.key}>
                    <span className={`dash-activity-dot dash-activity-dot-${tone}`} aria-hidden="true" />
                    <span className="dash-activity-date">{formatDisplayDate(item.date)}</span>
                    <span className="dash-activity-label">{item.label}</span>
                    <span className="dash-activity-symbol">{item.symbol ?? ""}</span>
                    <span className={`dash-activity-amount dash-activity-amount-${tone}`}>
                      {formatSignedMoney(item.amount, item.currency)}
                    </span>
                    <ChevronRight />
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        <article className="dash-panel dash-allocation">
          <header className="dash-panel-head">
            <h2 className="dash-panel-title">Asset allocation</h2>
          </header>
          <div className="dash-allocation-body">
            <div className="dash-allocation-info">
              <div className="dash-allocation-bar" aria-hidden="true">
                {allocationSlices
                  .filter((slice) => slice.pct > 0)
                  .map((slice) => (
                    <span
                      key={slice.key}
                      className={`dash-allocation-seg dash-allocation-${slice.className}`}
                      style={{ width: `${slice.pct}%` }}
                    />
                  ))}
              </div>
              <ul className="dash-allocation-legend">
                {allocationSlices.map((slice) => (
                  <li key={slice.key}>
                    <span className={`dash-legend-dot dash-allocation-${slice.className}`} aria-hidden="true" />
                    <span className="dash-legend-label">{slice.label}</span>
                    <span className="dash-legend-pct">{Math.round(slice.pct)}%</span>
                  </li>
                ))}
              </ul>
            </div>
            <AllocationDonut slices={allocationSlices} />
          </div>
        </article>
      </section>
    </div>
  );
}
