"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { api, type CurrentPosition, type DecimalValue } from "@/lib/api";

type SortKey =
  | "symbol"
  | "total_quantity"
  | "current_price"
  | "avg_cost"
  | "market_value"
  | "unrealized_pnl"
  | "unrealized_pnl_pct";
type SortDirection = "asc" | "desc";
type ConcentrationTone = "high" | "moderate" | "balanced" | "neutral";

type AllocationPoint = {
  symbol: string;
  avgCost: DecimalValue;
  marketValue: number;
  weight: number;
  color: string;
};

const POSITIONS_CURRENCY = "USD";

function decimalNumber(value: DecimalValue): number | null {
  if (value === null) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDecimal(value: DecimalValue, maximumFractionDigits = 2): string {
  const number = decimalNumber(value);
  return number === null
    ? "--"
    : number.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits,
      });
}

function formatCurrency(value: DecimalValue, currency = POSITIONS_CURRENCY): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }

  const prefix = currency === "USD" ? "US$" : `${currency} `;
  const formatted = Math.abs(number).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${number < 0 ? "-" : ""}${prefix}${formatted}`;
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

function formatWeight(value: number): string {
  return `${(value * 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function pnlClass(value: DecimalValue): string {
  const number = decimalNumber(value);
  if (number === null || number === 0) {
    return "";
  }
  return number > 0 ? "pnl-positive" : "pnl-negative";
}

function allocationColorForSymbol(symbol: string): string {
  let hash = 0;
  for (const character of symbol.toUpperCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  const hue = hash % 360;
  const saturation = 54 + (hash % 18);
  const lightness = 48 + ((hash >> 4) % 10);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function concentrationClass(tone: ConcentrationTone): string {
  return `positions-kpi-card concentration-card concentration-card-${tone}`;
}

function uniquePositionKey(row: CurrentPosition, index: number): string {
  const symbol = row.symbol?.trim().toUpperCase() ?? "";
  const conid = row.conid?.trim() ?? "";
  return symbol || conid ? `${symbol}:${conid}` : `row:${index}`;
}

function uniquePositions(rows: CurrentPosition[]): CurrentPosition[] {
  const byIdentity = new Map<string, CurrentPosition>();
  rows.forEach((row, index) => {
    const key = uniquePositionKey(row, index);
    if (!byIdentity.has(key)) {
      byIdentity.set(key, row);
    }
  });
  return Array.from(byIdentity.values());
}

function positionHref(symbol: string | null | undefined): string | undefined {
  if (!symbol) {
    return undefined;
  }
  return `/details/${encodeURIComponent(symbol.toUpperCase())}`;
}

function SortableHeader({
  activeKey,
  direction,
  label,
  onSort,
  sortKey,
}: {
  activeKey: SortKey;
  direction: SortDirection;
  label: string;
  onSort: (key: SortKey) => void;
  sortKey: SortKey;
}) {
  const isActive = activeKey === sortKey;

  return (
    <button
      aria-label={`Sort by ${label}`}
      className={`sortable-header-button${isActive ? " sortable-header-button-active" : ""}`}
      onClick={() => onSort(sortKey)}
      type="button"
    >
      <span>{label}</span>
      <span className="sort-indicator" aria-hidden="true">
        <span className={`sort-triangle${isActive && direction === "asc" ? " sort-triangle-active" : ""}`}>▲</span>
        <span className={`sort-triangle${isActive && direction === "desc" ? " sort-triangle-active" : ""}`}>▼</span>
      </span>
    </button>
  );
}

function comparePositions(left: CurrentPosition, right: CurrentPosition, sortKey: SortKey, direction: SortDirection): number {
  if (sortKey === "symbol") {
    const leftSymbol = left.symbol?.toUpperCase() ?? "";
    const rightSymbol = right.symbol?.toUpperCase() ?? "";
    const comparison = leftSymbol.localeCompare(rightSymbol);
    return direction === "asc" ? comparison : -comparison;
  }

  const leftValue = decimalNumber(left[sortKey]);
  const rightValue = decimalNumber(right[sortKey]);

  if (leftValue === null && rightValue === null) {
    return 0;
  }
  if (leftValue === null) {
    return 1;
  }
  if (rightValue === null) {
    return -1;
  }

  const comparison = leftValue - rightValue;
  return direction === "asc" ? comparison : -comparison;
}

function AllocationTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: AllocationPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="allocation-tooltip">
      <strong>{point.symbol}</strong>
      <span>Weight {formatWeight(point.weight)}</span>
      <span>Avg cost {formatCurrency(point.avgCost)}</span>
      <span>Market value {formatCurrency(point.marketValue)}</span>
    </div>
  );
}

export function PositionsView() {
  const [positions, setPositions] = useState<CurrentPosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("market_value");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    api.positions()
      .then((rows) => {
        if (active) {
          setPositions(rows);
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

  const currentPositions = useMemo(() => (positions ? uniquePositions(positions) : []), [positions]);

  const visiblePositions = useMemo(() => {
    const term = search.trim().toUpperCase();
    return currentPositions
      .filter((row) => !term || row.symbol?.toUpperCase().includes(term))
      .sort((left, right) => comparePositions(left, right, sortKey, sortDirection));
  }, [currentPositions, search, sortDirection, sortKey]);

  function chooseSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection("asc");
  }

  const columns: DataTableColumn<CurrentPosition>[] = [
    {
      key: "symbol",
      header: <SortableHeader activeKey={sortKey} direction={sortDirection} label="SYMBOL" onSort={chooseSort} sortKey="symbol" />,
      align: "center",
      render: (_, row) =>
        row.symbol ? (
          <Link className="symbol-link" href={positionHref(row.symbol) ?? "#"}>
            {row.symbol}
          </Link>
        ) : (
          "--"
        ),
    },
    {
      key: "total_quantity",
      header: <SortableHeader activeKey={sortKey} direction={sortDirection} label="QUANTITY" onSort={chooseSort} sortKey="total_quantity" />,
      align: "center",
      render: (value) => formatDecimal(value as DecimalValue, 4),
    },
    {
      key: "current_price",
      header: <SortableHeader activeKey={sortKey} direction={sortDirection} label="PRICE" onSort={chooseSort} sortKey="current_price" />,
      align: "center",
      render: (value) => formatCurrency(value as DecimalValue),
    },
    {
      key: "avg_cost",
      header: <SortableHeader activeKey={sortKey} direction={sortDirection} label="AVG COST" onSort={chooseSort} sortKey="avg_cost" />,
      align: "center",
      render: (value) => formatCurrency(value as DecimalValue),
    },
    {
      key: "market_value",
      header: <SortableHeader activeKey={sortKey} direction={sortDirection} label="MARKET VALUE" onSort={chooseSort} sortKey="market_value" />,
      align: "center",
      render: (value) => formatCurrency(value as DecimalValue),
    },
    {
      key: "unrealized_pnl",
      header: <SortableHeader activeKey={sortKey} direction={sortDirection} label="UNREALIZED P&L" onSort={chooseSort} sortKey="unrealized_pnl" />,
      align: "center",
      render: (value) => <span className={pnlClass(value as DecimalValue)}>{formatCurrency(value as DecimalValue)}</span>,
    },
    {
      key: "unrealized_pnl_pct",
      header: <SortableHeader activeKey={sortKey} direction={sortDirection} label="P&L %" onSort={chooseSort} sortKey="unrealized_pnl_pct" />,
      align: "center",
      render: (value) => <span className={pnlClass(value as DecimalValue)}>{formatPercent(value as DecimalValue)}</span>,
    },
  ];

  const totalMarketValue = positions ? currentPositions.reduce((sum, row) => sum + (decimalNumber(row.market_value) ?? 0), 0) : null;
  const allocationData = useMemo<AllocationPoint[]>(() => {
    if (!positions || totalMarketValue === null || totalMarketValue <= 0) {
      return [];
    }

    return currentPositions
      .map((row) => {
        const marketValue = decimalNumber(row.market_value);
        if (!row.symbol || marketValue === null || marketValue <= 0) {
          return null;
        }

        return {
          symbol: row.symbol,
          avgCost: row.avg_cost,
          marketValue,
          weight: marketValue / totalMarketValue,
          color: allocationColorForSymbol(row.symbol),
        };
      })
      .filter((item): item is AllocationPoint => item !== null)
      .sort((left, right) => right.marketValue - left.marketValue);
  }, [currentPositions, positions, totalMarketValue]);
  const topPosition = useMemo(() => {
    if (!positions || totalMarketValue === null || totalMarketValue <= 0) {
      return null;
    }

    return currentPositions.reduce<{ symbol: string; marketValue: number; weight: number } | null>((largest, row) => {
      const marketValue = decimalNumber(row.market_value);
      if (!row.symbol || marketValue === null || marketValue <= 0) {
        return largest;
      }

      const apiWeight = decimalNumber(row.weight_pct);
      const weight = apiWeight ?? marketValue / totalMarketValue;
      if (!largest || marketValue > largest.marketValue) {
        return {
          symbol: row.symbol,
          marketValue,
          weight,
        };
      }

      return largest;
    }, null);
  }, [currentPositions, positions, totalMarketValue]);
  const concentrationTone: ConcentrationTone = !topPosition
    ? "neutral"
    : topPosition.weight >= 0.5
      ? "high"
      : topPosition.weight >= 0.25
        ? "moderate"
        : "balanced";

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>Positions</h1>
          <p className="page-description">Your current holdings and unrealized performance in one gentle view.</p>
        </div>
      </div>
      {error ? (
        <section className="dashboard-state">
          <ErrorState message={error} title="Unable to load positions" />
        </section>
      ) : !positions ? (
        <section className="dashboard-state">
          <LoadingState message="Loading current positions..." />
        </section>
      ) : positions.length === 0 ? (
        <section className="dashboard-state">
          <EmptyState message="No current positions were found in the latest analyzed report." />
        </section>
      ) : (
        <>
          <section
            className={`stat-grid positions-overview${hoveredSymbol ? " positions-focus-active" : ""}`}
            aria-label="Position statistics"
          >
            <article className="positions-kpi-card positions-kpi-card-open" aria-label="Open Positions">
              <span className="stat-label">Open Positions</span>
              <strong className="stat-value">{currentPositions.length}</strong>
              <span className="stat-hint">Symbols held</span>
            </article>
            <article className={concentrationClass(concentrationTone)} aria-label="Concentration">
              <span className="stat-label">Concentration</span>
              <strong className="stat-value">{topPosition ? formatWeight(topPosition.weight) : "--"}</strong>
              <span className="stat-hint">{topPosition ? `Largest: ${topPosition.symbol}` : "No positions"}</span>
            </article>
            <article className="allocation-card soft-card" aria-label="Portfolio Allocation">
              {allocationData.length === 0 ? (
                <>
                  <div className="allocation-card-copy">
                    <p className="trend-title">Portfolio Allocation</p>
                    <p className="trend-subtitle">Market value weight by position</p>
                  </div>
                  <div className="allocation-empty">
                    <EmptyState message="Allocation appears when market values are available." />
                  </div>
                </>
              ) : (
                <div className="allocation-chart" onMouseLeave={() => setHoveredSymbol(null)}>
                  <div className="allocation-card-copy">
                    <p className="trend-title">Portfolio Allocation</p>
                    <p className="trend-subtitle">Market value weight by position</p>
                  </div>
                  <div className="allocation-donut-shell">
                    <ResponsiveContainer height="100%" width="100%">
                      <PieChart>
                        <Tooltip content={<AllocationTooltip />} cursor={false} />
                        <Pie
                          cx="50%"
                          cy="50%"
                          data={allocationData}
                          dataKey="marketValue"
                          innerRadius="55%"
                          minAngle={4}
                          nameKey="symbol"
                          onMouseEnter={(_, index) => setHoveredSymbol(allocationData[index]?.symbol ?? null)}
                          outerRadius="86%"
                          paddingAngle={0}
                          stroke="rgba(255, 253, 247, 0.92)"
                          strokeWidth={1}
                        >
                          {allocationData.map((point) => (
                            <Cell
                              className={`allocation-sector${hoveredSymbol === point.symbol ? " allocation-sector-active" : ""}${
                                hoveredSymbol && hoveredSymbol !== point.symbol ? " allocation-sector-dimmed" : ""
                              }`}
                              fill={point.color}
                              key={point.symbol}
                              opacity={hoveredSymbol && hoveredSymbol !== point.symbol ? 0.36 : 1}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="allocation-legend" aria-label="Portfolio allocation legend">
                    {allocationData.map((point) => (
                      <button
                        className={`allocation-legend-item${hoveredSymbol === point.symbol ? " allocation-legend-item-active" : ""}${
                          hoveredSymbol && hoveredSymbol !== point.symbol ? " allocation-legend-item-dimmed" : ""
                        }`}
                        key={point.symbol}
                        onMouseEnter={() => setHoveredSymbol(point.symbol)}
                        onMouseLeave={() => setHoveredSymbol(null)}
                        type="button"
                      >
                        <span className="allocation-legend-dot" style={{ backgroundColor: point.color }} />
                        <span className="allocation-legend-symbol">{point.symbol}</span>
                        <span className="allocation-legend-weight">{formatWeight(point.weight)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          </section>
          <section className={`panel positions-table-panel${hoveredSymbol ? " positions-focus-active" : ""}`}>
            <div className="panel-header positions-panel-header">
              <div>
                <h2>Current Holdings</h2>
                <p>
                  Showing {visiblePositions.length} of {currentPositions.length} positions. Select a symbol to view its details.
                </p>
              </div>
              <div className="table-controls positions-table-controls">
                <label className="search-field positions-search-field">
                  <span className="sr-only">Filter positions by symbol</span>
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
            <DataTable
              columns={columns}
              emptyMessage="No positions match that symbol."
              getRowClassName={(row) => {
                if (!hoveredSymbol) {
                  return undefined;
                }
                return row.symbol === hoveredSymbol ? "position-row-active" : "position-row-dimmed";
              }}
              getRowHref={(row) => positionHref(row.symbol)}
              getRowKey={(row, index) => uniquePositionKey(row, index)}
              rows={visiblePositions}
            />
          </section>
        </>
      )}
    </>
  );
}
