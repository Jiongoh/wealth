"use client";

import type { DecimalValue, PortfolioPerformanceDaily } from "@/lib/api";
import { formatDisplayDate, formatShortDisplayDate } from "@/lib/format";

type PerformanceCalendarProps = {
  currency: string | null;
  days: PortfolioPerformanceDaily[];
};

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

export function PerformanceCalendar({ currency, days }: PerformanceCalendarProps) {
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const daysByDate = new Map(sortedDays.map((day) => [day.date, day]));
  const calendarDates = recentThirtyDays();

  return (
    <article className="performance-card soft-card">
      <div className="performance-card-header">
        <div>
          <p className="performance-title">Performance Calendar</p>
          <p className="performance-description">Daily performance adjusted for deposits and withdrawals.</p>
        </div>
        <span className="performance-range">Last 30 days</span>
      </div>

      <div className="performance-calendar-grid" aria-label="Daily cash-flow adjusted performance">
        {calendarDates.map((date) => {
          const day = daysByDate.get(date) ?? null;
          const dayCurrency = day?.currency ?? currency;
          const tone = dayTone(day);
          const hasPerformance = day !== null && decimalNumber(day.performance_amount) !== null;
          const tooltipTone = hasPerformance ? tone : "empty";

          return (
            <div className={`performance-day performance-day-${tone}`} key={date} tabIndex={0}>
              <span className="performance-day-number">{dayNumber(date)}</span>
              <span className="performance-day-amount">
                {hasPerformance ? formatSignedMoney(day.performance_amount, dayCurrency) : "--"}
              </span>
              <span className="performance-day-percent">
                {hasPerformance ? formatSignedPercent(day.performance_pct) : "--"}
              </span>
              <div className={`performance-tooltip performance-tooltip-${tooltipTone}`} role="tooltip">
                {hasPerformance ? (
                  <>
                    <p className="performance-tooltip-date">{formatDisplayDate(day.date)}</p>
                    <p>External cash flow: {formatSignedMoney(day.external_cash_flow, dayCurrency)}</p>
                    <p>Performance: {formatSignedMoney(day.performance_amount, dayCurrency)}</p>
                    <p>Performance %: {formatSignedPercent(day.performance_pct)}</p>
                  </>
                ) : (
                  <span className="performance-no-data">
                    <span className="performance-no-data-icon" aria-hidden="true">
                      ...
                    </span>
                    <span className="performance-no-data-label">No data</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="performance-footer">
        {formatShortDisplayDate(calendarDates[0])} - {formatShortDisplayDate(calendarDates.at(-1))}
      </p>
    </article>
  );
}
