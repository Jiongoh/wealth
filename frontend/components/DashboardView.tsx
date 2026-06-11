"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { NavHistoryChart } from "@/components/NavHistoryChart";
import { PerformanceCalendar } from "@/components/PerformanceCalendar";
import { RealizedPnlChart } from "@/components/RealizedPnlChart";
import { StatCard } from "@/components/StatCard";
import {
  api,
  type NavDaily,
  type PortfolioPerformanceDaily,
  type PortfolioSummary,
  type RealizedPnlDaily,
  type RealizedPnlSummary,
} from "@/lib/api";
import { formatDisplayDate } from "@/lib/format";

type DashboardData = {
  summary: PortfolioSummary | null;
  navHistory: NavDaily[];
  performanceDaily: PortfolioPerformanceDaily[];
  realizedSummary: RealizedPnlSummary;
  realizedDaily: RealizedPnlDaily[];
};

function decimalNumber(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function recentThirtyDayRange(): { start_date: string; end_date: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 29);

  return {
    start_date: dateInputValue(start),
    end_date: dateInputValue(end),
  };
}

function dateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([
      api.portfolioSummary(),
      api.navHistory(),
      api.portfolioPerformanceDaily(recentThirtyDayRange()),
      api.realizedPnlSummary(),
      api.realizedPnlDaily(recentThirtyDayRange()),
    ])
      .then(([summary, navHistory, performanceDaily, realizedSummary, realizedDaily]) => {
        if (active) {
          setData({ summary, navHistory, performanceDaily, realizedSummary, realizedDaily });
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

  const { summary, navHistory, performanceDaily, realizedSummary, realizedDaily } = data;
  const realizedPnl = decimalNumber(realizedSummary.total_realized_pnl);
  const realizedPnlTone = realizedPnl !== null && realizedPnl < 0 ? "negative" : "positive";
  const realizedCurrency = realizedSummary.currency ?? summary.currency;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Latest portfolio snapshot</p>
          <h1>My Dashboard</h1>
          <p className="page-description">
            Report date: <strong>{formatDisplayDate(summary.report_date)}</strong>
            {summary.currency ? ` | Currency: ${summary.currency}` : ""}
          </p>
        </div>
      </div>
      <section className="performance-calendar-row" aria-label="Portfolio performance calendar">
        <PerformanceCalendar currency={summary.currency} days={performanceDaily} />
      </section>
      <section className="dashboard-chart-grid" aria-label="Portfolio charts">
        <article className="trend-card soft-card">
          <div className="trend-header">
            <div>
              <p className="trend-title">NAV history</p>
              <p className="trend-description">Total net asset value over time</p>
            </div>
            {summary.currency ? <span className="trend-tag">{summary.currency}</span> : null}
          </div>
          {navHistory.length === 0 ? (
            <EmptyState message="NAV history will appear after reports have been imported." />
          ) : (
            <NavHistoryChart currency={summary.currency} history={navHistory} />
          )}
        </article>
        <article className="trend-card soft-card">
          <div className="trend-header">
            <div>
              <p className="trend-title">Realized P/L</p>
              <p className="trend-description">Closed lot performance over the last 30 days</p>
            </div>
            {realizedCurrency ? <span className="trend-tag">{realizedCurrency}</span> : null}
          </div>
          {realizedDaily.length === 0 ? (
            <EmptyState message="Recent realized P/L will appear after closed lots are imported." />
          ) : (
            <RealizedPnlChart currency={realizedCurrency} history={realizedDaily} />
          )}
        </article>
      </section>
      <section className="stat-grid dashboard-stat-grid" aria-label="Portfolio statistics">
        <StatCard
          label="Total NAV"
          value={formatMoney(summary.total_nav, summary.currency)}
          hint={formatDisplayDate(summary.report_date)}
          tone="accent"
        />
        <StatCard
          label="Cash"
          value={formatMoney(summary.cash, summary.currency)}
          hint="Available balance"
          tone="warm"
        />
        <StatCard
          label="Stock Value"
          value={formatMoney(summary.stock, summary.currency)}
          hint="Market value"
        />
        <StatCard
          label="Realized P/L"
          value={formatMoney(realizedSummary.total_realized_pnl, realizedCurrency)}
          hint={
            realizedSummary.start_date && realizedSummary.end_date
              ? `${formatDisplayDate(realizedSummary.start_date)} - ${formatDisplayDate(realizedSummary.end_date)}`
              : "Closed lots"
          }
          valueTone={realizedPnlTone}
        />
      </section>
    </>
  );
}
