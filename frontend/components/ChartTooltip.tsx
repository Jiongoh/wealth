import type { ReactElement } from "react";

type TooltipEntry = {
  value?: number | string;
  name?: string | number;
  dataKey?: string | number;
};

type ChartTooltipProps = {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  labelFormatter: (label: string | number | undefined) => string;
  rowFor: (entry: TooltipEntry) => { label: string; value: string };
};

export function displayCurrency(currency: string | null | undefined): string {
  return !currency || currency === "MULTI" ? "USD" : currency;
}

export function formatPlainNumber(value: number | string | undefined): string {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }
  return number.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Shared recharts tooltip styled to match the daily-performance tooltip
// (cream card, coral hairline, dark label, coral numbers).
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  rowFor,
}: ChartTooltipProps): ReactElement | null {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-date">{labelFormatter(label)}</p>
      {payload.map((entry, index) => {
        const row = rowFor(entry);
        return (
          <p className="chart-tooltip-row" key={index}>
            <span className="chart-tooltip-label">{row.label}: </span>
            <span className="chart-tooltip-num">{row.value}</span>
          </p>
        );
      })}
    </div>
  );
}
