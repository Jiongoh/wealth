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
import { EmptyState } from "@/components/EmptyState";
import type { CashBalanceTimeseriesResponse, DecimalValue } from "@/lib/api";
import { formatShortDisplayDate } from "@/lib/format";

type CashHistoryChartProps = {
  history: CashBalanceTimeseriesResponse | null;
};

type ChartPoint = {
  date: string;
  [series: string]: number | string;
};

const CURRENCY_COLORS: Record<string, string> = {
  USD: "var(--accent-deep)",
  HKD: "var(--positive)",
  CNH: "var(--negative)",
};

const FALLBACK_COLORS = [
  "var(--accent)",
  "var(--warm-card)",
  "#CFE0F2",
  "#D8D3F0",
  "#EAD7B7",
  "var(--text-muted)",
];

function decimalNumber(value: DecimalValue): number | null {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatMoney(value: number, currency: string | null): string {
  if (!currency) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function colorForCurrency(currency: string, index: number): string {
  return CURRENCY_COLORS[currency] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export function CashHistoryChart({ history }: CashHistoryChartProps) {
  const items = history?.items ?? [];
  const currencies = (history?.currencies ?? []).filter(Boolean).sort();
  const dateMap = new Map<string, ChartPoint>();

  items.forEach((item) => {
    if (!item.date || !item.currency) {
      return;
    }

    const point = dateMap.get(item.date) ?? { date: item.date };
    const balance = decimalNumber(item.balance);

    if (balance !== null) {
      point[item.currency] = balance;
    }
    dateMap.set(item.date, point);
  });

  const points = Array.from(dateMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const visibleCurrencies = currencies.filter((currency) =>
    points.some((point) => typeof point[currency] === "number"),
  );

  const lastValues = new Map<string, number>();
  points.forEach((point) => {
    visibleCurrencies.forEach((currency) => {
      if (typeof point[currency] === "number") {
        lastValues.set(currency, point[currency] as number);
        return;
      }
      const previousValue = lastValues.get(currency);
      if (previousValue !== undefined) {
        point[currency] = previousValue;
      }
    });
  });

  if (points.length === 0 || visibleCurrencies.length === 0) {
    return <EmptyState message="No cash balance history found for this period." />;
  }

  return (
    <div className="cash-chart" aria-label="Cash history chart">
      <ResponsiveContainer width="100%" height={270}>
        <LineChart data={points} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
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
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              boxShadow: "var(--shadow-card)",
            }}
            formatter={(value, name) => {
              const currency = typeof name === "string" ? name : null;
              return [formatMoney(Number(value), currency), name];
            }}
            labelFormatter={(label) => formatShortDisplayDate(String(label))}
          />
          <Legend wrapperStyle={{ color: "var(--text-muted)", fontSize: 12, paddingTop: 8 }} />
          {visibleCurrencies.map((currency, index) => {
            const color = colorForCurrency(currency, index);
            return (
              <Line
                activeDot={{ fill: color, r: 5, stroke: "var(--surface)", strokeWidth: 3 }}
                dataKey={currency}
                dot={points.length === 1 ? { fill: color, r: 5, stroke: "var(--surface)", strokeWidth: 3 } : false}
                key={currency}
                name={currency}
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.6}
                type="monotone"
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
