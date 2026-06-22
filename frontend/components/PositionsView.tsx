"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ApiError, api, type CurrentPosition, type DecimalValue } from "@/lib/api";
import { POSITIONS_DEMO } from "@/lib/dashboardDemo";

const DEFAULT_LARGEST_NOTE = "The portfolio leans heavily here.";

type SortKey =
  | "symbol"
  | "total_quantity"
  | "avg_cost"
  | "market_value"
  | "unrealized_pnl"
  | "unrealized_pnl_pct";
type SortDirection = "asc" | "desc";

type AllocationRow = {
  symbol: string;
  marketValue: number;
  weight: number;
  tone: "coral" | "ink";
};

const POSITIONS_CURRENCY = "USD";

/**
 * Friendly business names for the symbols we hold. The current-positions
 * API does not carry a company name, so we fall back to this map (and to the
 * raw symbol when unknown). Labels mirror the editorial sample.
 */
const COMPANY_NAMES: Record<string, string> = {
  LITE: "Lithium Americas",
  QQQM: "Nasdaq 100 ETF",
  MU: "Micron Technology",
  IBKR: "Interactive Brokers",
};

function companyName(symbol: string | null | undefined): string {
  if (!symbol) {
    return "";
  }
  return COMPANY_NAMES[symbol.toUpperCase()] ?? "";
}

function decimalNumber(value: DecimalValue): number | null {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDecimal(value: DecimalValue, maximumFractionDigits = 4): string {
  const number = decimalNumber(value);
  return number === null
    ? "--"
    : number.toLocaleString(undefined, {
        minimumFractionDigits: 0,
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

function formatSignedCurrency(value: DecimalValue, currency = POSITIONS_CURRENCY): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }
  const prefix = currency === "USD" ? "US$" : `${currency} `;
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  const formatted = Math.abs(number).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${prefix}${formatted}`;
}

function formatSignedPercent(value: DecimalValue): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  const formatted = Math.abs(number * 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${formatted}%`;
}

function formatWeight(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Latest sync time rendered as a 24h UTC+8 clock, e.g. "14:30". */
function formatSyncTime(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return null;
  }
}

function pnlTone(value: DecimalValue): "up" | "down" | "flat" {
  const number = decimalNumber(value);
  if (number === null || number === 0) {
    return "flat";
  }
  return number > 0 ? "up" : "down";
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
  return `/details/${encodeURIComponent(symbol.toUpperCase())}?from=positions`;
}

function comparePositions(
  left: CurrentPosition,
  right: CurrentPosition,
  sortKey: SortKey,
  direction: SortDirection,
): number {
  if (sortKey === "symbol") {
    const leftSymbol = left.symbol?.toUpperCase() ?? "";
    const rightSymbol = right.symbol?.toUpperCase() ?? "";
    const comparison = leftSymbol.localeCompare(rightSymbol);
    return direction === "asc" ? comparison : -comparison;
  }

  const leftValue = decimalNumber(left[sortKey]);
  const rightValue = decimalNumber(right[sortKey]);

  if (leftValue === null && rightValue === null) return 0;
  if (leftValue === null) return 1;
  if (rightValue === null) return -1;

  const comparison = leftValue - rightValue;
  return direction === "asc" ? comparison : -comparison;
}

/** A wobbly, marker-drawn horizontal bar whose length encodes a weight. */
function AllocationBar({ tone }: { tone: AllocationRow["tone"] }) {
  return (
    <svg
      aria-hidden="true"
      className="pp-bar-stroke"
      preserveAspectRatio="none"
      viewBox="0 0 100 8"
    >
      <path
        d="M1 4.6 C 18 3.1, 33 5.8, 50 4.3 S 82 5.6, 99 3.9"
        fill="none"
        stroke={tone === "coral" ? "#cc785c" : "#2b2926"}
        strokeLinecap="round"
        strokeWidth={3.1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Decorative rising sparkline echoing the sample's "portfolio growth" sketch. */
function GrowthSketch() {
  return (
    <div className="pp-hero-art" aria-hidden="true">
      <span className="pp-hero-art-label">portfolio growth</span>
      <svg className="pp-hero-art-svg" viewBox="0 0 320 150" fill="none">
        <path
          d="M188 70 C 205 64, 214 60, 226 56"
          stroke="#2b2926"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M226 56 l -9 -1 m 9 1 l -3 8"
          stroke="#2b2926"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M8 132 L 312 132"
          stroke="#2b2926"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M298 126 l 12 6 l -12 6"
          stroke="#2b2926"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M14 124 C 46 120, 70 118, 96 104 S 138 92, 158 100 S 188 112, 206 86
             S 236 60, 256 64 S 286 34, 308 18"
          stroke="#cc785c"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M14 124 C 46 120, 70 118, 96 104 S 138 92, 158 100 S 188 112, 206 86
             S 236 60, 256 64 S 286 34, 308 18 L 308 132 L 14 132 Z"
          fill="#cc785c"
          opacity="0.1"
          stroke="none"
        />
        <path
          d="M300 26 l 9 -9 l 2 12"
          stroke="#cc785c"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

function SortHeader({
  activeKey,
  direction,
  label,
  onSort,
  sortKey,
  align,
}: {
  activeKey: SortKey;
  direction: SortDirection;
  label: string;
  onSort: (key: SortKey) => void;
  sortKey: SortKey;
  align?: "start" | "end";
}) {
  const isActive = activeKey === sortKey;
  return (
    <button
      className={`pp-th-button${align === "end" ? " pp-th-end" : ""}${isActive ? " pp-th-active" : ""}`}
      onClick={() => onSort(sortKey)}
      type="button"
    >
      <span>{label}</span>
      {isActive ? <span className="pp-th-caret" aria-hidden="true">{direction === "asc" ? "▲" : "▼"}</span> : null}
    </button>
  );
}

export function PositionsView() {
  const [positions, setPositions] = useState<CurrentPosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("market_value");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  // Per-symbol notes, sourced from the watchlist (keyed by upper-case symbol).
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  // Latest sync timestamp (ISO), sourced from the sync status endpoint.
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  const [isDemo] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") !== null,
  );

  useEffect(() => {
    let active = true;

    if (isDemo) {
      setPositions(POSITIONS_DEMO);
      setNotes({ LITE: "A majority position in Lithium Americas." });
      // Real latest ibkr_flex_sync finished_at from the server DB, so the local
      // preview reflects an actual timestamp rather than a fabricated one.
      setSyncedAt("2026-06-22T06:30:05Z"); // 14:30 UTC+8
      return () => {
        active = false;
      };
    }

    api
      .positions()
      .then((rows) => {
        if (active) setPositions(rows);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : "Request failed.");
        }
      });

    // Notes are stored on watchlist items; pull them in parallel. A failure
    // here must not block the positions table, so we swallow the error.
    api
      .watchlist()
      .then((items) => {
        if (!active) return;
        const map: Record<string, string> = {};
        for (const item of items) {
          if (item.symbol && item.notes) {
            map[item.symbol.toUpperCase()] = item.notes;
          }
        }
        setNotes(map);
      })
      .catch(() => undefined);

    // Latest IBKR Flex Report sync time for the footnote — specifically the
    // ibkr_flex_sync job (not whichever job ran most recently). Non-blocking.
    api
      .syncJobRuns("ibkr_flex_sync", { limit: 5 })
      .then((runs) => {
        if (!active) return;
        const lastSuccess = runs.find(
          (run) => run.status?.toLowerCase() === "success" && run.finished_at,
        );
        const latest = lastSuccess ?? runs.find((run) => run.finished_at) ?? runs[0];
        setSyncedAt(latest?.finished_at ?? latest?.started_at ?? null);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [isDemo]);

  const currentPositions = useMemo(() => (positions ? uniquePositions(positions) : []), [positions]);

  const totalMarketValue = useMemo(
    () => currentPositions.reduce((sum, row) => sum + (decimalNumber(row.market_value) ?? 0), 0),
    [currentPositions],
  );

  const allocation = useMemo<AllocationRow[]>(() => {
    if (totalMarketValue <= 0) {
      return [];
    }
    const entries: Array<{ symbol: string; marketValue: number; weight: number }> = [];
    for (const row of currentPositions) {
      const marketValue = decimalNumber(row.market_value);
      if (!row.symbol || marketValue === null || marketValue <= 0) {
        continue;
      }
      entries.push({ symbol: row.symbol, marketValue, weight: marketValue / totalMarketValue });
    }
    return entries
      .sort((left, right) => right.marketValue - left.marketValue)
      .map((row, index) => ({ ...row, tone: index === 0 ? ("coral" as const) : ("ink" as const) }));
  }, [currentPositions, totalMarketValue]);

  const largest = allocation[0] ?? null;
  const maxWeight = largest?.weight ?? 1;

  // The bars card always shows at most 4 hand-drawn lines: the top 3 holdings
  // plus an aggregated "Others" line for everything beyond rank 3.
  const allocationBars = useMemo<AllocationRow[]>(() => {
    if (allocation.length <= 3) {
      return allocation;
    }
    const rest = allocation.slice(3);
    const others: AllocationRow = {
      symbol: "Others",
      marketValue: rest.reduce((sum, row) => sum + row.marketValue, 0),
      weight: rest.reduce((sum, row) => sum + row.weight, 0),
      tone: "ink",
    };
    return [...allocation.slice(0, 3), others];
  }, [allocation]);

  const visiblePositions = useMemo(() => {
    const term = search.trim().toUpperCase();
    return currentPositions
      .filter((row) => {
        if (!term) return true;
        const symbol = row.symbol?.toUpperCase() ?? "";
        return symbol.includes(term) || companyName(row.symbol).toUpperCase().includes(term);
      })
      .sort((left, right) => comparePositions(left, right, sortKey, sortDirection));
  }, [currentPositions, search, sortDirection, sortKey]);

  function chooseSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "symbol" ? "asc" : "desc");
  }

  const positionCount = currentPositions.length;
  const syncedTime = formatSyncTime(syncedAt);

  const largestSymbolKey = largest ? largest.symbol.toUpperCase() : null;
  const storedNote = largestSymbolKey ? notes[largestSymbolKey] ?? "" : "";
  const noteText = storedNote.trim() ? storedNote : DEFAULT_LARGEST_NOTE;

  function startEditNote() {
    setNoteDraft(storedNote);
    setNoteError(null);
    setEditingNote(true);
  }

  function cancelEditNote() {
    setEditingNote(false);
    setNoteError(null);
  }

  async function saveNote() {
    if (!largest || !largestSymbolKey) {
      return;
    }
    const symbol = largest.symbol;
    const value = noteDraft.trim();
    setNoteSaving(true);
    setNoteError(null);

    try {
      if (!isDemo) {
        try {
          await api.updateWatchlistTicker(symbol, { notes: value || null });
        } catch (requestError: unknown) {
          // The symbol may not be on the watchlist yet — create it so the note
          // has somewhere to live, mirroring the watchlist data model.
          if (requestError instanceof ApiError && requestError.status === 404) {
            await api.createWatchlistTicker({ symbol, notes: value || null });
          } else {
            throw requestError;
          }
        }
      }
      setNotes((prev) => ({ ...prev, [largestSymbolKey]: value }));
      setEditingNote(false);
    } catch (requestError: unknown) {
      setNoteError(requestError instanceof Error ? requestError.message : "Could not save note.");
    } finally {
      setNoteSaving(false);
    }
  }

  return (
    <div className="positions-page">
      <header className="pp-hero">
        <div className="pp-hero-copy">
          <p className="pp-eyebrow">Portfolio</p>
          <h1 className="pp-title">Positions</h1>
          <p className="pp-lede">A quiet view of the businesses you currently own.</p>
          {positions && positionCount > 0 ? (
            <p className="pp-meta">
              {positionCount} {positionCount === 1 ? "position" : "positions"}
              <span className="pp-meta-dot" aria-hidden="true">•</span>
              {formatCurrency(totalMarketValue)} market value
            </p>
          ) : null}
        </div>
        <GrowthSketch />
      </header>

      {error ? (
        <section className="pp-state">
          <ErrorState message={error} title="Unable to load positions" />
        </section>
      ) : !positions ? (
        <section className="pp-state">
          <LoadingState message="Loading current positions..." />
        </section>
      ) : positionCount === 0 ? (
        <section className="pp-state">
          <EmptyState message="No current positions were found in the latest analyzed report." />
        </section>
      ) : (
        <>
          <section className="pp-allocation">
            <article className="pp-largest-card">
              <p className="pp-largest-label">Largest Allocation</p>
              <p className="pp-largest-value">{largest ? `${(largest.weight * 100).toFixed(2)}%` : "--"}</p>
              <p className="pp-largest-symbol">{largest?.symbol ?? "--"}</p>
              <span className="pp-largest-rule" aria-hidden="true" />
              {editingNote ? (
                <div className="pp-note-editor">
                  <textarea
                    autoFocus
                    className="pp-note-textarea"
                    maxLength={280}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder={DEFAULT_LARGEST_NOTE}
                    rows={3}
                    value={noteDraft}
                  />
                  {noteError ? <p className="pp-note-error">{noteError}</p> : null}
                  <div className="pp-note-actions">
                    <button className="pp-note-cancel" onClick={cancelEditNote} type="button">
                      Cancel
                    </button>
                    <button className="pp-note-save" disabled={noteSaving} onClick={saveNote} type="button">
                      {noteSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="pp-largest-note"
                  onClick={startEditNote}
                  title="Edit note"
                  type="button"
                >
                  <span className={storedNote.trim() ? undefined : "pp-largest-note-muted"}>{noteText}</span>
                  <span className="pp-note-edit-hint" aria-hidden="true">✎</span>
                </button>
              )}
            </article>

            <article className="pp-bars-card">
              <div className="pp-bars">
                {allocationBars.map((row) => (
                  <div className="pp-bar-row" key={row.symbol}>
                    <span className="pp-bar-symbol">{row.symbol}</span>
                    <span className="pp-bar-track">
                      <span
                        className="pp-bar-fill"
                        style={{ width: `${Math.max(8, (row.weight / maxWeight) * 100)}%` }}
                      >
                        <AllocationBar tone={row.tone} />
                      </span>
                    </span>
                    <span className="pp-bar-weight">{formatWeight(row.weight)}</span>
                  </div>
                ))}
              </div>
              <div className="pp-bars-aside">
                <span className="pp-aside-tag">Largest holding</span>
                <p className="pp-aside-note">
                  {largest?.symbol ?? "Your top position"} continues to play a central role in the portfolio.
                </p>
              </div>
            </article>
          </section>

          <section className="pp-ownership">
            <div className="pp-ownership-head">
              <div>
                <h2 className="pp-ownership-title">Ownership</h2>
                <p className="pp-ownership-sub">A record of businesses currently held in the portfolio.</p>
              </div>
              <label className="pp-search">
                <span className="sr-only">Filter positions by symbol</span>
                <svg className="pp-search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M16 16 L 21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search symbol"
                  type="search"
                  value={search}
                />
              </label>
            </div>

            <div className="pp-table-wrap soft-scrollbar">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th className="pp-col-symbol">
                      <SortHeader activeKey={sortKey} direction={sortDirection} label="Symbol" onSort={chooseSort} sortKey="symbol" />
                    </th>
                    <th className="pp-col-num">
                      <SortHeader activeKey={sortKey} direction={sortDirection} label="Quantity" onSort={chooseSort} sortKey="total_quantity" align="end" />
                    </th>
                    <th className="pp-col-num">
                      <SortHeader activeKey={sortKey} direction={sortDirection} label="Avg Cost" onSort={chooseSort} sortKey="avg_cost" align="end" />
                    </th>
                    <th className="pp-col-num">
                      <SortHeader activeKey={sortKey} direction={sortDirection} label="Market Value" onSort={chooseSort} sortKey="market_value" align="end" />
                    </th>
                    <th className="pp-col-num">
                      <SortHeader activeKey={sortKey} direction={sortDirection} label="Unrealized P&L" onSort={chooseSort} sortKey="unrealized_pnl" align="end" />
                    </th>
                    <th className="pp-col-num">
                      <SortHeader activeKey={sortKey} direction={sortDirection} label="P&L %" onSort={chooseSort} sortKey="unrealized_pnl_pct" align="end" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePositions.length === 0 ? (
                    <tr>
                      <td className="pp-empty-cell" colSpan={6}>
                        <EmptyState message="No positions match that symbol." title="Nothing to show" />
                      </td>
                    </tr>
                  ) : (
                    visiblePositions.map((row, index) => {
                      const href = positionHref(row.symbol);
                      const tone = pnlTone(row.unrealized_pnl);
                      return (
                        <tr
                          className="pp-row"
                          key={uniquePositionKey(row, index)}
                          onClick={href ? () => window.location.assign(href) : undefined}
                          role={href ? "link" : undefined}
                          tabIndex={href ? 0 : undefined}
                          onKeyDown={
                            href
                              ? (event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    window.location.assign(href);
                                  }
                                }
                              : undefined
                          }
                        >
                          <td className="pp-col-symbol">
                            <div className="pp-cell-symbol">
                              {row.symbol ? (
                                <Link className="pp-symbol-ticker" href={href ?? "#"} onClick={(event) => event.stopPropagation()}>
                                  {row.symbol}
                                </Link>
                              ) : (
                                <span className="pp-symbol-ticker">--</span>
                              )}
                              <span className="pp-symbol-name">{companyName(row.symbol) || "—"}</span>
                            </div>
                          </td>
                          <td className="pp-col-num pp-num">{formatDecimal(row.total_quantity)}</td>
                          <td className="pp-col-num pp-num">{formatCurrency(row.avg_cost)}</td>
                          <td className="pp-col-num pp-num">{formatCurrency(row.market_value)}</td>
                          <td className="pp-col-num">
                            <span className={`pp-pnl pp-pnl-${tone}`}>
                              {formatSignedCurrency(row.unrealized_pnl)}
                              {tone !== "flat" ? (
                                <span className="pp-pnl-arrow" aria-hidden="true">{tone === "up" ? "↑" : "↓"}</span>
                              ) : null}
                            </span>
                          </td>
                          <td className="pp-col-num">
                            <span className={`pp-pnl pp-pnl-${tone}`}>{formatSignedPercent(row.unrealized_pnl_pct)}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p className="pp-footnote">
            {syncedTime ? `Synced ${syncedTime} UTC+8 · ` : ""}Powered by
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Interactive Brokers"
              className="pp-footnote-logo"
              src="/Interactive_Brokers_Logo_(2014).svg"
            />
          </p>
        </>
      )}
    </div>
  );
}
