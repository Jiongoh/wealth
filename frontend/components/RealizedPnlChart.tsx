"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip, displayCurrency, formatPlainNumber } from "@/components/ChartTooltip";
import { EmptyState } from "@/components/EmptyState";
import type { DecimalValue, RealizedPnlDaily } from "@/lib/api";
import { formatShortDisplayDate } from "@/lib/format";

type RealizedPnlChartProps = {
  currency: string | null;
  history: RealizedPnlDaily[];
};

type ChartPoint = {
  date: string;
  [series: string]: number | string;
};

const SERIES_COLORS = ["#d97757", "var(--positive)", "var(--negative)", "var(--text-muted)"];

function decimalNumber(value: DecimalValue): number | null {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function RealizedPnlChart({ currency, history }: RealizedPnlChartProps) {
  const currencies = Array.from(
    new Set(history.map((item) => item.currency ?? currency).filter(Boolean)),
  ).sort() as string[];
  const series =
    currencies.length > 0
      ? currencies.map((item, index) => ({
          key: item,
          label: item,
          currency: item,
          color: SERIES_COLORS[index % SERIES_COLORS.length],
        }))
      : [{ key: "Realized P/L", label: "Realized P/L", currency: null, color: SERIES_COLORS[0] }];

  const dateMap = new Map<string, ChartPoint>();
  history.forEach((item) => {
    const value = decimalNumber(item.realized_pnl);
    if (value === null || value === 0) {
      return;
    }
    const key = item.currency ?? currency ?? "Realized P/L";
    const point = dateMap.get(item.date) ?? { date: item.date };
    point[key] = value;
    dateMap.set(item.date, point);
  });

  const points = Array.from(dateMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const visibleSeries = series.filter((line) => points.some((point) => typeof point[line.key] === "number"));
  const hasNonZeroValue = visibleSeries.some((line) =>
    points.some((point) => typeof point[line.key] === "number" && point[line.key] !== 0),
  );

  if (points.length === 0 || visibleSeries.length === 0 || !hasNonZeroValue) {
    return <EmptyState message="No realized P/L in this period." />;
  }

  return (
    <div className="realized-chart" aria-label="Realized profit and loss chart">
      <ResponsiveContainer width="100%" height={212}>
        <LineChart data={points} margin={{ top: 12, right: 14, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="4 8" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="date"
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            tickFormatter={formatShortDisplayDate}
            tickLine={false}
          />
          <YAxis
            axisLine={false}
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            tickFormatter={(value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            tickLine={false}
            width={58}
          />
          <Tooltip
            content={
              <ChartTooltip
                labelFormatter={(label) => formatShortDisplayDate(String(label))}
                rowFor={(entry) => ({
                  label: displayCurrency(typeof entry.name === "string" ? entry.name : currency),
                  value: formatPlainNumber(entry.value),
                })}
              />
            }
          />
          {visibleSeries.length > 1 ? (
            <Legend wrapperStyle={{ color: "var(--text-muted)", fontSize: 12, paddingTop: 8 }} />
          ) : null}
          {visibleSeries.map((line) => (
            <Line
              activeDot={{ fill: line.color, r: 5, stroke: "var(--surface)", strokeWidth: 3 }}
              dataKey={line.key}
              dot={points.length === 1 ? { fill: line.color, r: 5, stroke: "var(--surface)", strokeWidth: 3 } : false}
              key={line.key}
              name={line.label}
              stroke={line.color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              type="monotone"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
