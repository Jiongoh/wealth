"use client";

import type { DecimalValue, PortfolioPerformanceDaily } from "@/lib/api";
import { formatDisplayDate } from "@/lib/format";

type PerformanceCalendarProps = {
  currency: string | null;
  days: PortfolioPerformanceDaily[];
  rangeLabel?: string;
};

const COLUMNS = 10;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function decimalNumber(value: DecimalValue): number | null {
  if (value === null) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function displayCurrency(currency: string | null): string {
  return !currency || currency === "MULTI" ? "USD" : currency;
}

function formatSignedMoney(value: DecimalValue, currency: string | null): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }

  const formatted = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: displayCurrency(currency),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(number));

  if (number > 0) {
    return `+${formatted}`;
  }
  if (number < 0) {
    return `-${formatted}`;
  }
  return formatted;
}

// External cash flow is shown in its native currency (no FX conversion), so we
// use a plain "<sign><CODE> <amount>" format (e.g. "+CNH 1,000.00") rather than
// Intl currency styling, which rejects non-ISO codes like CNH.
function formatSignedFlow(value: DecimalValue, currency: string | null): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }

  const amount = Math.abs(number).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = number > 0 ? "+" : number < 0 ? "-" : "";
  return `${sign}${displayCurrency(currency)} ${amount}`;
}

function formatSignedPercent(value: DecimalValue): string {
  const number = decimalNumber(value);
  if (number === null) {
    return "--";
  }

  const formatted = `${Math.abs(number * 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;

  if (number > 0) {
    return `+${formatted}`;
  }
  if (number < 0) {
    return `-${formatted}`;
  }
  return formatted;
}

function dayNumber(value: string): string {
  return value.split("-")[2]?.replace(/^0/, "") || value;
}

function dayTone(day: PortfolioPerformanceDaily | null): string {
  if (!day) {
    return "empty";
  }

  const amount = decimalNumber(day.performance_amount);
  if (amount === null) {
    return "empty";
  }
  if (Math.abs(amount) < 0.005) {
    return "neutral";
  }
  return amount > 0 ? "positive" : "negative";
}

function dateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekdayShort(value: string): string {
  const parts = value.split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return WEEKDAYS[date.getDay()] ?? "";
}

function recentThirtyDays(): string[] {
  const end = new Date();
  const days: string[] = [];

  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setDate(end.getDate() - offset);
    days.push(dateInputValue(date));
  }

  return days;
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

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

export function PerformanceCalendar({ currency, days, rangeLabel }: PerformanceCalendarProps) {
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const daysByDate = new Map(sortedDays.map((day) => [day.date, day]));
  const rows = chunk(recentThirtyDays(), COLUMNS);

  return (
    <article className="dperf-panel">
      <header className="dperf-head">
        <h2 className="dperf-title">Daily performance</h2>
        {rangeLabel ? (
          <button className="dash-daterange" type="button">
            <CalendarIcon />
            <span>{rangeLabel}</span>
            <ChevronDown />
          </button>
        ) : null}
      </header>

      <div className="dperf-grid" aria-label="Daily cash-flow adjusted performance">
        {rows.map((row) => (
          <div className="dperf-row" key={row[0]}>
            <span className="dperf-weekday">{weekdayShort(row[0])}</span>
            <div className="dperf-cells">
              {row.map((date) => {
                const day = daysByDate.get(date) ?? null;
                const dayCurrency = day?.currency ?? currency;
                const tone = dayTone(day);
                const hasPerformance =
                  day !== null && decimalNumber(day.performance_amount) !== null;

                return (
                  <div className={`dperf-cell dperf-cell-${tone}`} key={date} tabIndex={0}>
                    <span className="dperf-cell-day">{dayNumber(date)}</span>
                    {hasPerformance ? (
                      <>
                        <span className="dperf-cell-amount">
                          {formatSignedMoney(day.performance_amount, dayCurrency)}
                        </span>
                        <span className="dperf-cell-percent">
                          {formatSignedPercent(day.performance_pct)}
                        </span>
                      </>
                    ) : (
                      <span className="dperf-cell-empty">—</span>
                    )}

                    {hasPerformance ? (
                      <div className={`dperf-tooltip dperf-tooltip-${tone}`} role="tooltip">
                        <p className="dperf-tooltip-date">{formatDisplayDate(day.date)}</p>
                        {(day.external_cash_flows ?? []).map((flow, flowIndex) => (
                          <p key={`${flow.currency ?? "?"}-${flowIndex}`}>
                            External cash flow:{" "}
                            <span className="dperf-tooltip-num">
                              {formatSignedFlow(flow.amount, flow.currency)}
                            </span>
                          </p>
                        ))}
                        <p>
                          Performance:{" "}
                          <span className="dperf-tooltip-num">
                            {formatSignedMoney(day.performance_amount, dayCurrency)}
                          </span>
                        </p>
                        <p>
                          Performance %:{" "}
                          <span className="dperf-tooltip-num">
                            {formatSignedPercent(day.performance_pct)}
                          </span>
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
