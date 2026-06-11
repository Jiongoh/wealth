"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { StatCard } from "@/components/StatCard";
import { api, type DecimalValue, type LotAnalysis, type PositionLot } from "@/lib/api";
import { formatDisplayDate } from "@/lib/format";

type LotsViewProps = {
  embedded?: boolean;
  from?: "positions" | "watchlist";
  symbol?: string;
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

function formatPercent(value: DecimalValue): string {
  const number = decimalNumber(value);
  return number === null
    ? "--"
    : `${(number * 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}%`;
}

function pnlClass(value: DecimalValue): string {
  const number = decimalNumber(value);
  return number === null || number === 0 ? "" : number > 0 ? "pnl-positive" : "pnl-negative";
}

function lotProfitPct(row: PositionLot): number | null {
  const markPrice = decimalNumber(row.mark_price);
  const costPrice = decimalNumber(row.cost_basis_price);
  if (markPrice !== null && costPrice !== null && costPrice !== 0) {
    return (markPrice - costPrice) / costPrice;
  }

  const pnl = decimalNumber(row.unrealized_pnl);
  const costBasis = decimalNumber(row.cost_basis_money);
  if (pnl !== null && costBasis !== null && costBasis !== 0) {
    return pnl / Math.abs(costBasis);
  }

  return null;
}

const lotAnalysisColumns: DataTableColumn<PositionLot>[] = [
  { key: "symbol", header: "Symbol", align: "center", render: (value) => String(value ?? "--") },
  {
    key: "quantity",
    header: "Quantity",
    align: "center",
    render: (value) => formatNumber(value as DecimalValue, 4),
  },
  {
    key: "cost_basis_price",
    header: "Cost Price",
    align: "center",
    render: (value, row) => formatMoney(value as DecimalValue, row.currency),
  },
  {
    key: "cost_basis_money",
    header: "Cost Basis",
    align: "center",
    render: (value, row) => formatMoney(value as DecimalValue, row.currency),
  },
  { key: "open_datetime", header: "Opened", align: "center", render: (value) => formatDisplayDate(value as string | null) },
  {
    key: "unrealized_pnl",
    header: "Profit Over 20%",
    align: "center",
    render: (_value, row) => {
      const profitPct = lotProfitPct(row);
      return profitPct !== null && profitPct >= 0.2 ? (
        <span className="threshold-badge threshold-badge-strong">Yes</span>
      ) : (
        <span className="threshold-clear">No</span>
      );
    },
  },
  {
    key: "unrealized_pnl",
    header: "Unrealized P&L (%)",
    align: "center",
    render: (value, row) => {
      const profitPct = lotProfitPct(row);
      return (
        <span className={pnlClass(value as DecimalValue)}>
          {formatMoney(value as DecimalValue, row.currency)} ({formatPercent(profitPct)})
        </span>
      );
    },
  },
];

function backLink(from: LotsViewProps["from"]): { href: string; label: string } {
  if (from === "watchlist") {
    return { href: "/watchlist", label: "Back to Watchlist" };
  }
  if (from === "positions") {
    return { href: "/positions", label: "Back to Positions" };
  }
  return { href: "/watchlist", label: "Back" };
}

export function LotsView({ embedded = false, from, symbol }: LotsViewProps) {
  const [data, setData] = useState<{ lots: PositionLot[]; analysis: LotAnalysis[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);

    if (!symbol) {
      setData({ lots: [], analysis: [] });
      return () => {
        active = false;
      };
    }

    Promise.all([api.lots(symbol), api.lotAnalysis()])
      .then(([lots, analysis]) => {
        if (active) {
          const filteredAnalysis = symbol
            ? analysis.filter((row) => row.symbol?.toUpperCase() === symbol)
            : analysis;
          setData({ lots, analysis: filteredAnalysis });
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
  }, [symbol]);

  const aggregate = useMemo(() => {
    if (!data) {
      return null;
    }
    const currency = data.lots.find((lot) => lot.currency)?.currency ?? null;
    const quantity = data.lots.reduce((sum, lot) => sum + (decimalNumber(lot.quantity) ?? 0), 0);
    const value = data.lots.reduce((sum, lot) => sum + (decimalNumber(lot.position_value) ?? 0), 0);
    const pnl = data.lots.reduce((sum, lot) => sum + (decimalNumber(lot.unrealized_pnl) ?? 0), 0);
    const costBasis = data.lots.reduce((sum, lot) => sum + (decimalNumber(lot.cost_basis_money) ?? 0), 0);
    const analysisRow = data.analysis[0];
    const currentPrice =
      decimalNumber(analysisRow?.current_price ?? null) ??
      data.lots.find((lot) => decimalNumber(lot.mark_price) !== null)?.mark_price ??
      null;
    const avgCost =
      decimalNumber(analysisRow?.avg_cost ?? null) ??
      (quantity !== 0 ? costBasis / quantity : null);
    return { avgCost, currency, currentPrice, pnl, quantity, value };
  }, [data]);

  const pnlTone = aggregate && aggregate.pnl < 0 ? "negative" : "positive";
  const lots = data?.lots ?? [];
  const analysis = data?.analysis ?? [];
  const back = backLink(from);

  if (!symbol) {
    if (embedded) {
      return (
        <section className="dashboard-state details-embedded-state">
          <EmptyState message="No current lots." />
        </section>
      );
    }

    return (
      <>
        <div className="page-header">
          <div>
            <p className="eyebrow">Portfolio detail</p>
            <h1>Lots</h1>
            <p className="page-description">Please select a ticker from Positions or Watchlist to view lots.</p>
          </div>
          <Link className="action-link" href={back.href}>
            {back.label}
          </Link>
        </div>
        <section className="dashboard-state">
          <EmptyState message="Lots is now a detail page. Open it from a held position or watchlist ticker." />
        </section>
      </>
    );
  }

  return (
    <>
      {embedded ? null : (
        <div className="page-header">
          <div>
            <p className="eyebrow">Portfolio</p>
            <h1>Lots</h1>
            <p className="page-description">
              {symbol ? `Open tax lots filtered for ${symbol}.` : "Open tax lots and cost basis details for thoughtful decisions."}
            </p>
          </div>
          <Link className="action-link" href={back.href}>
            {back.label}
          </Link>
        </div>
      )}
      {error ? (
        <section className={`dashboard-state${embedded ? " details-embedded-state" : ""}`}>
          <ErrorState message={error} title="Unable to load lots" />
        </section>
      ) : !data ? (
        <section className={`dashboard-state${embedded ? " details-embedded-state" : ""}`}>
          <LoadingState message="Loading lot analysis and open lots..." />
        </section>
      ) : (
        <>
          {!embedded && lots.length > 0 ? (
            <section className="stat-grid" aria-label="Lot statistics">
              <StatCard label="Open Lots" value={String(lots.length)} hint={symbol ?? "Across symbols"} tone="accent" />
              <StatCard label="Quantity" value={formatNumber(aggregate?.quantity ?? null, 4)} hint="Units held" tone="warm" />
              <StatCard label="Market Value" value={formatMoney(aggregate?.value ?? null, aggregate?.currency ?? null)} hint="Open lots" />
              <StatCard
                label="Lot P&L"
                value={formatMoney(aggregate?.pnl ?? null, aggregate?.currency ?? null)}
                hint="Unrealized"
                tone="dark"
                valueTone={pnlTone}
              />
              <StatCard
                label="Current Price"
                value={formatMoney(aggregate?.currentPrice ?? null, aggregate?.currency ?? null)}
                hint="Latest mark"
                tone="warm"
              />
              <StatCard
                label="Avg Cost"
                value={formatMoney(aggregate?.avgCost ?? null, aggregate?.currency ?? null)}
                hint="Weighted cost"
                tone="accent"
              />
            </section>
          ) : null}
          <section className="panel lots-analysis-panel">
            <div className="panel-header">
              <div>
                <h2>{symbol ? `${symbol} Lot Analysis` : "Lot Analysis"}</h2>
                <p>Cost basis, opening date, and unrealized performance by tax lot.</p>
              </div>
            </div>
            <DataTable
              columns={lotAnalysisColumns}
              emptyMessage={symbol ? `No lot analysis is available for ${symbol}.` : "No lot analysis data is available."}
              getRowKey={(row, index) => row.originating_transaction_id ?? index}
              rows={lots}
            />
          </section>
        </>
      )}
    </>
  );
}
