"use client";

import { useEffect, useMemo, useState } from "react";
import { CashHistoryChart } from "@/components/CashHistoryChart";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { StatCard } from "@/components/StatCard";
import {
  api,
  type CashActivity,
  type CashActivityListResponse,
  type CashBalanceTimeseriesResponse,
  type DecimalValue,
} from "@/lib/api";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/format";

type CashFilters = {
  startDate: string;
  endDate: string;
  currency: string;
  activityType: string;
};

type CashFilterOptions = {
  currencies: string[];
  activityTypes: string[];
};

type CashDropdownKey = "currency" | "activityType";

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultFilters(): CashFilters {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - 1);

  return {
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
    currency: "",
    activityType: "",
  };
}

function decimalNumber(value: DecimalValue): number | null {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatMoney(value: DecimalValue, currency: string | null): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }
  if (!currency) {
    return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function amountClass(value: DecimalValue): string {
  const number = decimalNumber(value);
  return number === null || number === 0 ? "" : number > 0 ? "pnl-positive" : "pnl-negative";
}

function formatActivityType(value: string | null): string {
  if (!value) {
    return "--";
  }
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function latestBalanceByCurrency(history: CashBalanceTimeseriesResponse | null): Map<string, { balance: DecimalValue; date: string }> {
  const latest = new Map<string, { balance: DecimalValue; date: string }>();

  (history?.items ?? []).forEach((row) => {
    if (!row.currency || !row.date) {
      return;
    }
    const currency = row.currency.toUpperCase();
    const current = latest.get(currency);
    if (!current || row.date > current.date) {
      latest.set(currency, { balance: row.balance, date: row.date });
    }
  });

  return latest;
}

function activityOptionsFromResult(result: CashActivityListResponse): CashFilterOptions {
  const currencies = new Set<string>();
  const activityTypes = new Set<string>();

  result.items.forEach((row) => {
    if (row.currency) {
      currencies.add(row.currency);
    }
    if (row.activity_type) {
      activityTypes.add(row.activity_type);
    }
  });

  Object.entries(result.by_type ?? {}).forEach(([activityType, count]) => {
    if (count > 0) {
      activityTypes.add(activityType);
    }
  });

  return {
    currencies: Array.from(currencies).sort((a, b) => a.localeCompare(b)),
    activityTypes: Array.from(activityTypes).sort((a, b) => a.localeCompare(b)),
  };
}

const columns: DataTableColumn<CashActivity>[] = [
  {
    key: "activity_date",
    header: "Date",
    align: "center",
    render: (value, row) =>
      row.activity_datetime ? formatDisplayDateTime(row.activity_datetime) : formatDisplayDate(value as string | null),
  },
  {
    key: "activity_type",
    header: "Type",
    align: "center",
    render: (value) => <span className="trade-side">{formatActivityType(value as string | null)}</span>,
  },
  { key: "currency", header: "Currency", align: "center", render: (value) => String(value ?? "--") },
  {
    key: "amount",
    header: "Amount",
    align: "center",
    render: (value, row) => (
      <span className={amountClass(value as DecimalValue)}>{formatMoney(value as DecimalValue, row.currency)}</span>
    ),
  },
  {
    key: "description",
    header: "Description",
    align: "center",
    render: (value, row) => String(value ?? row.fx_pair ?? row.symbol ?? "--"),
  },
  { key: "source_section", header: "Source", align: "center", render: (value) => String(value ?? "--") },
];

export function CashView() {
  const [filters, setFilters] = useState<CashFilters>(() => getDefaultFilters());
  const [cashBalanceHistory, setCashBalanceHistory] = useState<CashBalanceTimeseriesResponse | null>(null);
  const [cashActivities, setCashActivities] = useState<CashActivityListResponse | null>(null);
  const [filterOptions, setFilterOptions] = useState<CashFilterOptions>({ currencies: [], activityTypes: [] });
  const [openDropdown, setOpenDropdown] = useState<CashDropdownKey | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isActivityLoading, setIsActivityLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!openDropdown) {
      return;
    }

    function closeDropdownOnOutsideClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-cash-dropdown="true"]')) {
        return;
      }
      setOpenDropdown(null);
    }

    document.addEventListener("mousedown", closeDropdownOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeDropdownOnOutsideClick);
  }, [openDropdown]);

  useEffect(() => {
    let active = true;

    async function loadCashHistoryAndOptions() {
      try {
        setIsHistoryLoading(true);
        setError(null);
        const [balanceHistory, options] = await Promise.all([
          api.cashBalanceTimeseries(),
          api.cashActivities(),
        ]);
        if (active) {
          setCashBalanceHistory(balanceHistory);
          setFilterOptions(activityOptionsFromResult(options));
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Unable to load cash data.");
          setCashBalanceHistory({ items: [], currencies: [] });
          setFilterOptions({ currencies: [], activityTypes: [] });
        }
      } finally {
        if (active) {
          setIsHistoryLoading(false);
        }
      }
    }

    void loadCashHistoryAndOptions();

    return () => {
      active = false;
    };
  }, []);

  const latestBalances = useMemo(() => latestBalanceByCurrency(cashBalanceHistory), [cashBalanceHistory]);

  useEffect(() => {
    let active = true;
    const timeoutId = window.setTimeout(() => {
      const normalizedFilters = {
        ...filters,
        currency: filters.currency.trim().toUpperCase(),
        activityType: filters.activityType.trim().toUpperCase(),
      };

      if (normalizedFilters.startDate && normalizedFilters.endDate && normalizedFilters.startDate > normalizedFilters.endDate) {
        setCashActivities({ items: [], total_count: 0, by_type: {} });
        setIsActivityLoading(false);
        setError("Start date must not be after end date.");
        return;
      }

      setIsActivityLoading(true);
      setError(null);

      api.cashActivities({
        start_date: normalizedFilters.startDate || undefined,
        end_date: normalizedFilters.endDate || undefined,
        currency: normalizedFilters.currency || undefined,
        activity_type: normalizedFilters.activityType || undefined,
      })
        .then((activities) => {
          if (active) {
            setCashActivities(activities);
          }
        })
        .catch((caught: unknown) => {
          if (active) {
            setError(caught instanceof Error ? caught.message : "Unable to load cash movements.");
            setCashActivities({ items: [], total_count: 0, by_type: {} });
          }
        })
        .finally(() => {
          if (active) {
            setIsActivityLoading(false);
          }
        });
    }, 400);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [filters]);

  function updateFilters(nextFilters: CashFilters) {
    const normalizedCurrency = nextFilters.currency.trim().toUpperCase();

    if (nextFilters.startDate && nextFilters.endDate && nextFilters.startDate > nextFilters.endDate) {
      setError("Start date must not be after end date.");
      return;
    }

    setFilters({ ...nextFilters, currency: normalizedCurrency, activityType: nextFilters.activityType.trim().toUpperCase() });
  }

  function resetFilters() {
    const nextFilters = getDefaultFilters();
    setFilters(nextFilters);
    setOpenDropdown(null);
    setError(null);
  }

  function selectCurrency(currency: string) {
    updateFilters({ ...filters, currency });
    setOpenDropdown(null);
  }

  function selectActivityType(activityType: string) {
    updateFilters({ ...filters, activityType });
    setOpenDropdown(null);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Cash</h1>
          <p className="page-description">Cash balances and actual cash movement activity from IBKR Flex reports.</p>
        </div>
      </div>

      {!isHistoryLoading && !error ? (
        <section className="stat-grid" aria-label="Cash statistics">
          <StatCard
            label="USD Cash"
            value={formatMoney(latestBalances.get("USD")?.balance ?? null, "USD")}
            hint={
              latestBalances.get("USD")
                ? `Latest · ${formatDisplayDate(latestBalances.get("USD")?.date ?? null)}`
                : "Latest balance"
            }
            tone="accent"
          />
          <StatCard
            label="HKD Cash"
            value={formatMoney(latestBalances.get("HKD")?.balance ?? null, "HKD")}
            hint={
              latestBalances.get("HKD")
                ? `Latest · ${formatDisplayDate(latestBalances.get("HKD")?.date ?? null)}`
                : "Latest balance"
            }
            tone="warm"
          />
          <StatCard
            label="CNH Cash"
            value={formatMoney(latestBalances.get("CNH")?.balance ?? null, "CNH")}
            hint={
              latestBalances.get("CNH")
                ? `Latest · ${formatDisplayDate(latestBalances.get("CNH")?.date ?? null)}`
                : "Latest balance"
            }
          />
          <StatCard
            label="Cash Transactions"
            value={String(cashActivities?.total_count ?? 0)}
            hint="Cash activity records"
            tone="dark"
          />
        </section>
      ) : null}

      <section className="panel cash-chart-panel">
        <div className="panel-header">
          <div>
            <h2>Cash Curves</h2>
            <p>Cash balance history by currency.</p>
          </div>
        </div>
        {isHistoryLoading ? (
          <div className="panel-state">
            <LoadingState message="Loading cash history..." />
          </div>
        ) : (
          <CashHistoryChart history={cashBalanceHistory} />
        )}
      </section>

      <section className="panel cash-table-panel cash-filter-panel">
        <div className="panel-header">
          <div>
            <h2>Cash Filters</h2>
            <p>Filter cash movements by activity date, currency, and activity type.</p>
          </div>
        </div>
        <div className="cash-filter-block">
          <div className="trade-filters cash-filters">
            <label className="filter-field">
              <span>Start date</span>
              <span className="positions-search-shell trade-filter-input-shell">
                <input
                  onChange={(event) => updateFilters({ ...filters, startDate: event.target.value })}
                  type="date"
                  value={filters.startDate}
                />
              </span>
            </label>
            <label className="filter-field">
              <span>End date</span>
              <span className="positions-search-shell trade-filter-input-shell">
                <input
                  onChange={(event) => updateFilters({ ...filters, endDate: event.target.value })}
                  type="date"
                  value={filters.endDate}
                />
              </span>
            </label>
            <label className="filter-field filter-field-limit">
              <span>Currency</span>
              <div className="cash-select" data-cash-dropdown="true">
                <button
                  aria-expanded={openDropdown === "currency"}
                  className="cash-select-button"
                  onClick={() => setOpenDropdown((current) => (current === "currency" ? null : "currency"))}
                  type="button"
                >
                  <span>{filters.currency || "All currencies"}</span>
                  <span className="cash-select-chevron" aria-hidden="true">
                    ▾
                  </span>
                </button>
                {openDropdown === "currency" ? (
                  <div className="cash-select-menu soft-scrollbar" role="listbox">
                    <button
                      className={`cash-select-option${!filters.currency ? " cash-select-option-active" : ""}`}
                      onClick={() => selectCurrency("")}
                      type="button"
                    >
                      All currencies
                    </button>
                    {filterOptions.currencies.map((currency) => (
                      <button
                        className={`cash-select-option${filters.currency === currency ? " cash-select-option-active" : ""}`}
                        key={currency}
                        onClick={() => selectCurrency(currency)}
                        type="button"
                      >
                        {currency}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </label>
            <label className="filter-field filter-field-limit">
              <span>Type</span>
              <div className="cash-select" data-cash-dropdown="true">
                <button
                  aria-expanded={openDropdown === "activityType"}
                  className="cash-select-button"
                  onClick={() => setOpenDropdown((current) => (current === "activityType" ? null : "activityType"))}
                  type="button"
                >
                  <span>{filters.activityType ? formatActivityType(filters.activityType) : "All types"}</span>
                  <span className="cash-select-chevron" aria-hidden="true">
                    ▾
                  </span>
                </button>
                {openDropdown === "activityType" ? (
                  <div className="cash-select-menu soft-scrollbar" role="listbox">
                    <button
                      className={`cash-select-option${!filters.activityType ? " cash-select-option-active" : ""}`}
                      onClick={() => selectActivityType("")}
                      type="button"
                    >
                      All types
                    </button>
                    {filterOptions.activityTypes.map((activityType) => (
                      <button
                        className={`cash-select-option${filters.activityType === activityType ? " cash-select-option-active" : ""}`}
                        key={activityType}
                        onClick={() => selectActivityType(activityType)}
                        type="button"
                      >
                        {formatActivityType(activityType)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </label>
            <div className="filter-actions">
              <button className="action-link" disabled={isActivityLoading} onClick={resetFilters} type="button">
                Reset
              </button>
            </div>
          </div>
          {error ? <ErrorState message={error} title="Unable to load cash movements" /> : null}
        </div>
      </section>

      <section className="panel cash-table-panel">
        <div className="panel-header">
          <div>
            <h2>Cash Activity</h2>
            <p>Deposits, withdrawals, FX conversions, dividends, interest, fees, and taxes from imported reports.</p>
          </div>
        </div>
        {isActivityLoading ? (
          <div className="panel-state">
            <LoadingState message="Loading cash movement rows..." />
          </div>
        ) : (
          <DataTable
            columns={columns}
            emptyMessage="No cash movements found for this period."
            getRowKey={(row, index) => `${row.id}-${row.external_id ?? index}`}
            rows={cashActivities?.items ?? []}
          />
        )}
      </section>
    </>
  );
}
