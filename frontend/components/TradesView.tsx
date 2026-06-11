"use client";

import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { StatCard } from "@/components/StatCard";
import { api, type DecimalValue, type Trade, type TradeListResponse } from "@/lib/api";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/format";

type TradeFilters = {
  symbol: string;
  startDate: string;
  endDate: string;
};

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultFilters(): TradeFilters {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - 1);

  return {
    symbol: "",
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
  };
}

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

function sideClass(value: string | null): string {
  const normalized = value?.toUpperCase();
  if (normalized === "BUY") {
    return "trade-side trade-side-buy";
  }
  if (normalized === "SELL") {
    return "trade-side trade-side-sell";
  }
  return "trade-side";
}

function formatFilterDateRange(filters: TradeFilters): string {
  if (filters.startDate && filters.endDate) {
    return `${formatDisplayDate(filters.startDate)} - ${formatDisplayDate(filters.endDate)}`;
  }
  if (filters.startDate) {
    return `From ${formatDisplayDate(filters.startDate)}`;
  }
  if (filters.endDate) {
    return `Until ${formatDisplayDate(filters.endDate)}`;
  }
  return "All dates";
}

const columns: DataTableColumn<Trade>[] = [
  { key: "trade_date", header: "Trade Date", render: (value) => formatDisplayDate(value as string | null) },
  { key: "datetime", header: "Date/Time", render: (value) => formatDisplayDateTime(value as string | null) },
  { key: "symbol", header: "Symbol", render: (value) => String(value ?? "--") },
  {
    key: "buy_sell",
    header: "Side",
    render: (value) => <span className={sideClass(value as string | null)}>{String(value ?? "--")}</span>,
  },
  {
    key: "quantity",
    header: "Quantity",
    align: "right",
    render: (value) => formatNumber(value as DecimalValue, 4),
  },
  {
    key: "trade_price",
    header: "Trade Price",
    align: "right",
    render: (value, row) => formatMoney(value as DecimalValue, row.currency),
  },
  {
    key: "trade_money",
    header: "Trade Money",
    align: "right",
    render: (value, row) => formatMoney(value as DecimalValue, row.currency),
  },
  {
    key: "ib_commission",
    header: "Commission",
    align: "right",
    render: (value, row) => formatMoney(value as DecimalValue, row.ib_commission_currency ?? row.currency),
  },
  {
    key: "net_cash",
    header: "Net Cash",
    align: "right",
    render: (value, row) => formatMoney(value as DecimalValue, row.currency),
  },
  {
    key: "realized_pnl",
    header: "Realized P&L",
    align: "right",
    render: (value, row) => (
      <span className={pnlClass(value as DecimalValue)}>{formatMoney(value as DecimalValue, row.currency)}</span>
    ),
  },
  { key: "open_close_indicator", header: "Open/Close", render: (value) => String(value ?? "--") },
  { key: "level_of_detail", header: "Detail", render: (value) => String(value ?? "--") },
];

export function TradesView() {
  const [filters, setFilters] = useState<TradeFilters>(() => getDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<TradeFilters>(() => getDefaultFilters());
  const [tradeResult, setTradeResult] = useState<TradeListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timeoutId = window.setTimeout(() => {
      const nextFilters = { ...filters, symbol: filters.symbol.trim().toUpperCase() };

      if (nextFilters.startDate && nextFilters.endDate && nextFilters.startDate > nextFilters.endDate) {
        setError("Start date must not be after end date.");
        setIsLoading(false);
        return;
      }

      setError(null);
      setIsLoading(true);

      api.trades({
        symbol: nextFilters.symbol || undefined,
        start_date: nextFilters.startDate || undefined,
        end_date: nextFilters.endDate || undefined,
      })
        .then((result) => {
          if (active) {
            setTradeResult(result);
            setAppliedFilters(nextFilters);
          }
        })
        .catch((requestError: unknown) => {
          if (active) {
            setError(requestError instanceof Error ? requestError.message : "Request failed.");
          }
        })
        .finally(() => {
          if (active) {
            setIsLoading(false);
          }
        });
    }, 400);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [filters]);

  function resetFilters() {
    const nextFilters = getDefaultFilters();
    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setError(null);
  }

  const trades = tradeResult?.items ?? null;
  const buyRows = trades?.filter((trade) => trade.buy_sell?.toUpperCase() === "BUY").length ?? 0;
  const sellRows = trades?.filter((trade) => trade.buy_sell?.toUpperCase() === "SELL").length ?? 0;
  const activeSymbolFilter = appliedFilters.symbol || "All symbols";
  const activeDateFilter = formatFilterDateRange(appliedFilters);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Trades</h1>
          <p className="page-description">Historical transactions imported from your Flex statements.</p>
        </div>
      </div>
      {tradeResult ? (
        <section className="stat-grid" aria-label="Trade statistics">
          <StatCard label="Total Trades" value={String(tradeResult.total_count)} hint="Current filters" tone="accent" />
          <StatCard label="Buy Rows" value={String(buyRows)} hint="Rows currently shown" tone="warm" />
          <StatCard label="Sell Rows" value={String(sellRows)} hint="Rows currently shown" />
          <StatCard label="Active Filters" value={activeSymbolFilter} hint={activeDateFilter} tone="dark" />
        </section>
      ) : null}
      <section className="panel trade-filter-panel">
        <div className="panel-header">
          <div>
            <h2>Trade Filters</h2>
            <p>Showing security trades from the past month by default.</p>
          </div>
        </div>
        <div className="trade-filters">
          <label className="filter-field">
            <span>Symbol</span>
            <span className="positions-search-shell trade-filter-input-shell">
              <input
                onChange={(event) => setFilters((current) => ({ ...current, symbol: event.target.value }))}
                placeholder="Search symbol"
                type="search"
                value={filters.symbol}
              />
            </span>
          </label>
          <label className="filter-field">
            <span>Start date</span>
            <span className="positions-search-shell trade-filter-input-shell">
              <input
                onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
                type="date"
                value={filters.startDate}
              />
            </span>
          </label>
          <label className="filter-field">
            <span>End date</span>
            <span className="positions-search-shell trade-filter-input-shell">
              <input
                onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
                type="date"
                value={filters.endDate}
              />
            </span>
          </label>
          <div className="filter-actions">
            <button className="secondary-button trade-reset-button" disabled={isLoading} onClick={resetFilters} type="button">
              Reset
            </button>
          </div>
        </div>
        {error ? <ErrorState message={error} title="Unable to load trades" /> : null}
      </section>
      <section className="panel trade-table-panel">
        <div className="panel-header">
          <div>
            <h2>Trade History</h2>
            <p>Sorted from the most recent trade date returned by the API.</p>
          </div>
        </div>
        {isLoading ? (
          <div className="panel-state">
            <LoadingState message="Loading trade history..." />
          </div>
        ) : (
          <DataTable
            columns={columns}
            emptyMessage="No trades match the selected filters."
            getRowKey={(row, index) => row.transaction_id ?? row.ib_execution_id ?? index}
            rows={trades ?? []}
          />
        )}
      </section>
    </>
  );
}
