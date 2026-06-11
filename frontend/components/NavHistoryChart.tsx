"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/EmptyState";
import type { NavDaily } from "@/lib/api";
import { formatShortDisplayDate } from "@/lib/format";

type NavHistoryChartProps = {
  currency: string | null;
  history: NavDaily[];
};

type ChartPoint = {
  date: string;
  total: number;
};

function formatMoney(value: number, currency: string | null): string {
  if (!currency) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function NavHistoryChart({ currency, history }: NavHistoryChartProps) {
  const pointMap = new Map<string, ChartPoint>();
  history
    .filter((item): item is NavDaily & { report_date: string } => item.report_date !== null)
    .forEach((item) => {
      const total = Number(item.total);
      if (Number.isFinite(total)) {
        pointMap.set(item.report_date, {
          date: item.report_date,
          total,
        });
      }
    });
  const points = Array.from(pointMap.values()).sort((left, right) => left.date.localeCompare(right.date));

  if (points.length === 0) {
    return <EmptyState message="NAV history does not contain displayable values yet." />;
  }

  return (
    <div className="nav-chart" aria-label="Net asset value history chart">
      <ResponsiveContainer width="100%" height={212}>
        <AreaChart data={points} margin={{ top: 12, right: 14, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="navFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.34} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.03} />
            </linearGradient>
          </defs>
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
            formatter={(value) => [formatMoney(Number(value), currency), "Total NAV"]}
            labelFormatter={(label) => formatShortDisplayDate(String(label))}
          />
          <Area
            activeDot={{ fill: "var(--accent)", r: 6, stroke: "var(--surface)", strokeWidth: 3 }}
            dataKey="total"
            dot={
              points.length === 1
                ? { fill: "var(--accent)", r: 6, stroke: "var(--surface)", strokeWidth: 3 }
                : false
            }
            fill="url(#navFill)"
            stroke="var(--accent-deep)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
