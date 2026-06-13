"use client";

import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { api, type DecimalValue, type LotAnalysis, type PositionLot } from "@/lib/api";
import { formatDisplayDate } from "@/lib/format";

// LotsView is embedded inside the ticker details page; the standalone /lots
// route was removed once lot analysis was folded into details.
type LotsViewProps = {
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
    // Column keys must be unique; this column derives from the row, so any
    // otherwise-unused field works as its key.
    key: "open_price",
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

export function LotsView({ symbol }: LotsViewProps) {
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
          const filteredAnalysis = analysis.filter((row) => row.symbol?.toUpperCase() === symbol);
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

  const lots = data?.lots ?? [];

  if (!symbol) {
    return (
      <section className="dashboard-state details-embedded-state">
        <EmptyState message="No current lots." />
      </section>
    );
  }

  if (error) {
    return (
      <section className="dashboard-state details-embedded-state">
        <ErrorState message={error} title="Unable to load lots" />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="dashboard-state details-embedded-state">
        <LoadingState message="Loading lot analysis and open lots..." />
      </section>
    );
  }

  return (
    <section className="panel lots-analysis-panel">
      <div className="panel-header">
        <div>
          <h2>{symbol} Lot Analysis</h2>
          <p>Cost basis, opening date, and unrealized performance by tax lot.</p>
        </div>
      </div>
      <DataTable
        columns={lotAnalysisColumns}
        emptyMessage={`No lot analysis is available for ${symbol}.`}
        getRowKey={(row, index) => row.originating_transaction_id ?? index}
        rows={lots}
      />
    </section>
  );
}
