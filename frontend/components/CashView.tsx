"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import {
  api,
  type CashActivity,
  type CashActivityListResponse,
  type CashBalancePoint,
  type CashBalanceTimeseriesResponse,
  type DecimalValue,
} from "@/lib/api";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/format";

// Approximate FX rates → USD, used to convert native balances into a single
// "cash equivalent" for the total, the allocation donut, and the share splits.
// The page is a liquidity snapshot, not an accounting ledger, so slightly-stale
// reference rates are acceptable — the footnote calls this out explicitly.
const FX_RATES_TO_USD: Record<string, number> = {
  USD: 1,
  HKD: 0.1285,
  CNH: 0.14546,
  CNY: 0.14546,
};

const CURRENCY_TONE: Record<string, string> = {
  USD: "var(--accent)",
  CNH: "var(--positive)",
  HKD: "#e8a55a",
};

// Currency symbols for native-amount rendering in badges / snapshot cards.
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  HKD: "HK$",
  CNH: "¥",
  CNY: "¥",
};

type CurrencySnapshot = {
  currency: string;
  balance: number;
  usdEquivalent: number;
  share: number;
  series: number[];
  deltaPct: number | null;
  depositDelta: number | null;
  depositDateLabel: string | null;
  isStep: boolean;
};

// ---------------------------------------------------------------------------
// Demo data — mirrors the account's real liquidity so a local preview without
// a backend still renders a faithful page (same pattern as TradesView /
// WatchlistView). Numbers reconstruct the design mock exactly.
// ---------------------------------------------------------------------------
const DEMO_SYNC_LABEL = "Jun 18, 2026 09:41 AM";

const DEMO_BALANCES: { currency: string; balance: number }[] = [
  { currency: "USD", balance: 201.89 },
  { currency: "HKD", balance: 354.0 },
  { currency: "CNH", balance: 1000.0 },
];

const DEMO_SERIES: Record<string, number[]> = {
  USD: [244, 238, 246, 232, 240, 226, 234, 218, 210, 205, 202],
  HKD: [362, 358, 366, 355, 360, 352, 356, 350, 353, 350, 354],
  CNH: [0, 0, 0, 0, 0, 0, 0, 620, 1000, 1000, 1000],
};

const DEMO_DELTAS: Record<string, { deltaPct: number | null; depositDelta: number | null; depositDateLabel: string | null }> = {
  USD: { deltaPct: -0.17, depositDelta: null, depositDateLabel: null },
  HKD: { deltaPct: -0.02, depositDelta: null, depositDateLabel: null },
  CNH: { deltaPct: null, depositDelta: 1000, depositDateLabel: "Jun 10 deposit" },
};

function demoActivity(overrides: Partial<CashActivity> & Pick<CashActivity, "id">): CashActivity {
  return {
    report_date: null,
    activity_date: null,
    activity_datetime: null,
    account_id: null,
    currency: "USD",
    amount: null,
    activity_type: null,
    description: null,
    source_section: null,
    symbol: null,
    fx_pair: null,
    related_trade_id: null,
    external_id: null,
    ...overrides,
  };
}

const DEMO_ACTIVITIES: CashActivity[] = [
  demoActivity({
    id: 1,
    activity_date: "2026-06-10",
    currency: "CNH",
    amount: 1000,
    activity_type: "DEPOSIT",
    description: "Cash report deposit movement",
    source_section: "Deposits & Withdrawals",
  }),
  demoActivity({
    id: 2,
    activity_date: "2026-06-05",
    currency: "USD",
    amount: -0.35,
    activity_type: "COMMISSION",
    description: "Buy 0.056 MU",
    source_section: "TRADES",
    symbol: "MU",
    related_trade_id: "demo-mu-1",
  }),
  demoActivity({
    id: 3,
    activity_date: "2026-06-05",
    currency: "USD",
    amount: -0.35,
    activity_type: "COMMISSION",
    description: "Sell 0.14 SNDK",
    source_section: "TRADES",
    symbol: "SNDK",
    related_trade_id: "demo-sndk-2",
  }),
  demoActivity({
    id: 4,
    activity_date: "2026-05-27",
    currency: "HKD",
    amount: -0.05,
    activity_type: "FX_CONVERSION",
    description: "HKD $0.05 → USD $0.01 auto FX conversion",
    source_section: "FX Transactions",
    fx_pair: "HKD.USD",
  }),
  demoActivity({
    id: 5,
    activity_date: "2026-05-26",
    activity_datetime: "2026-05-26T21:32:00+00:00",
    currency: "HKD",
    amount: -2.74,
    activity_type: "FX_CONVERSION",
    description: "HKD $2.74 → USD $0.35 auto FX conversion",
    source_section: "FX Transactions",
    fx_pair: "HKD.USD",
  }),
  demoActivity({
    id: 6,
    activity_date: "2026-05-26",
    activity_datetime: "2026-05-26T19:24:00+00:00",
    currency: "HKD",
    amount: -0.71,
    activity_type: "FX_CONVERSION",
    description: "HKD $0.71 → USD $0.09 auto FX conversion",
    source_section: "FX Transactions",
    fx_pair: "HKD.USD",
  }),
  demoActivity({
    id: 7,
    activity_date: "2026-05-28",
    currency: "USD",
    amount: -0.35,
    activity_type: "COMMISSION",
    description: "Buy 0.116 LITE",
    source_section: "TRADES",
    symbol: "LITE",
    related_trade_id: "demo-lite-1",
  }),
  demoActivity({
    id: 8,
    activity_date: "2026-05-26",
    currency: "USD",
    amount: -0.35,
    activity_type: "COMMISSION",
    description: "Sell 1 IREN",
    source_section: "TRADES",
    symbol: "IREN",
    related_trade_id: "demo-iren-1",
  }),
];

const DEMO_TIMESERIES: CashBalanceTimeseriesResponse = {
  currencies: ["USD", "HKD", "CNH"],
  items: DEMO_BALANCES.flatMap(({ currency, balance }) =>
    DEMO_SERIES[currency].map((value, index) => ({
      date: `2026-06-${String(8 + index).padStart(2, "0")}`,
      currency,
      balance: index === DEMO_SERIES[currency].length - 1 ? balance : value,
    })),
  ),
};

const DEMO_ACTIVITY_RESPONSE: CashActivityListResponse = {
  items: DEMO_ACTIVITIES,
  total_count: DEMO_ACTIVITIES.length,
  by_type: DEMO_ACTIVITIES.reduce<Record<string, number>>((counts, activity) => {
    const key = activity.activity_type ?? "OTHER";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {}),
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function decimalNumber(value: DecimalValue): number | null {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rateFor(currency: string): number {
  return FX_RATES_TO_USD[currency.toUpperCase()] ?? 1;
}

function symbolFor(currency: string | null): string {
  if (!currency) {
    return "";
  }
  return CURRENCY_SYMBOL[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
}

function toneFor(currency: string): string {
  return CURRENCY_TONE[currency.toUpperCase()] ?? "var(--text-muted)";
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNative(value: number, currency: string | null): string {
  const symbol = symbolFor(currency);
  const magnitude = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${magnitude}`;
}

function formatSignedNative(value: number, currency: string | null): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatNative(value, currency)}`;
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatActivityType(value: string | null): string {
  if (!value) {
    return "Activity";
  }
  return value
    .toLowerCase()
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Data derivation from the cash timeseries + activity feed
// ---------------------------------------------------------------------------
function buildSnapshots(
  timeseries: CashBalanceTimeseriesResponse | null,
  demoOverride: boolean,
): CurrencySnapshot[] {
  const byCurrency = new Map<string, CashBalancePoint[]>();
  (timeseries?.items ?? []).forEach((point) => {
    if (!point.currency || !point.date) {
      return;
    }
    const currency = point.currency.toUpperCase();
    const list = byCurrency.get(currency) ?? [];
    list.push(point);
    byCurrency.set(currency, list);
  });

  const snapshots: CurrencySnapshot[] = [];

  byCurrency.forEach((points, currency) => {
    const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const series = sorted.map((point) => decimalNumber(point.balance) ?? 0);
    const balance = series[series.length - 1] ?? 0;
    const earliest = series[0] ?? 0;

    let deltaPct: number | null = null;
    let depositDelta: number | null = null;
    let depositDateLabel: string | null = null;

    if (demoOverride && DEMO_DELTAS[currency]) {
      deltaPct = DEMO_DELTAS[currency].deltaPct;
      depositDelta = DEMO_DELTAS[currency].depositDelta;
      depositDateLabel = DEMO_DELTAS[currency].depositDateLabel;
    } else if (Math.abs(earliest) < 0.01 && balance > 0.01) {
      // Rose from ~zero — express the move as an absolute funding event.
      depositDelta = balance;
    } else if (Math.abs(earliest) > 0.01) {
      deltaPct = (balance - earliest) / Math.abs(earliest);
    }

    const isStep = Math.abs(earliest) < 0.01 && balance > 0.01;

    snapshots.push({
      currency,
      balance,
      usdEquivalent: balance * rateFor(currency),
      share: 0,
      series: series.length > 1 ? series : [balance, balance],
      deltaPct,
      depositDelta,
      depositDateLabel,
      isStep,
    });
  });

  const totalUsd = snapshots.reduce((sum, snapshot) => sum + snapshot.usdEquivalent, 0);
  snapshots.forEach((snapshot) => {
    snapshot.share = totalUsd > 0 ? snapshot.usdEquivalent / totalUsd : 0;
  });

  // Sort by USD weight, descending — the largest holding leads every surface.
  snapshots.sort((a, b) => b.usdEquivalent - a.usdEquivalent);
  return snapshots;
}

function buildNarrative(activities: CashActivity[]): string[] {
  if (activities.length === 0) {
    return ["No cash movements have been recorded for this period yet."];
  }

  const deposits = activities.filter(
    (activity) => (decimalNumber(activity.amount) ?? 0) > 0 && /DEPOSIT/i.test(activity.activity_type ?? ""),
  );
  const largestDeposit = deposits.reduce<CashActivity | null>((best, activity) => {
    const amount = decimalNumber(activity.amount) ?? 0;
    const bestAmount = best ? decimalNumber(best.amount) ?? 0 : -Infinity;
    return amount > bestAmount ? activity : best;
  }, null);

  const hasCommissions = activities.some((activity) => /COMMISSION|FEE/i.test(activity.activity_type ?? ""));
  const commissionCurrency =
    activities.find((activity) => /COMMISSION|FEE/i.test(activity.activity_type ?? ""))?.currency ?? "USD";
  const hasWithdrawals = activities.some(
    (activity) => (decimalNumber(activity.amount) ?? 0) < 0 && /WITHDRAWAL/i.test(activity.activity_type ?? ""),
  );

  const lines: string[] = [];

  if (largestDeposit) {
    const amount = decimalNumber(largestDeposit.amount) ?? 0;
    lines.push(
      `On ${formatDisplayDate(largestDeposit.activity_date)}, a ${largestDeposit.currency ?? ""} deposit of ` +
        `${formatNative(amount, largestDeposit.currency)} increased total liquidity.`,
    );
  } else {
    lines.push("Balances held steady across all accounts through this period.");
  }

  if (hasCommissions) {
    lines.push(
      `Since then, balances have remained stable with only minor commission deductions in ${commissionCurrency}.`,
    );
  }

  lines.push(
    hasWithdrawals
      ? "Withdrawals during this period were limited to routine settlement."
      : "No withdrawals were recorded during this period.",
  );

  return lines;
}

// ---------------------------------------------------------------------------
// Activity-type visual mapping
// ---------------------------------------------------------------------------
type ActivityVisual = { icon: ReactNode; toneClass: string };

function DepositIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="17">
      <path d="M12 5v11" />
      <path d="M7 12l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function WithdrawalIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="17">
      <path d="M12 19V8" />
      <path d="M7 12l5-5 5 5" />
      <path d="M5 4h14" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 24 24" width="17">
      <path d="M6 12h12" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="17">
      <path d="M4 8h13l-3-3" />
      <path d="M20 16H7l3 3" />
    </svg>
  );
}

function CoinIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="17">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M9.5 10.5h3.2a1.5 1.5 0 0 1 0 3H10a1.5 1.5 0 0 0 0 3h3.2" />
    </svg>
  );
}

function activityVisual(activity: CashActivity): ActivityVisual {
  const type = (activity.activity_type ?? "").toUpperCase();
  const amount = decimalNumber(activity.amount) ?? 0;

  if (/FX/.test(type)) {
    return { icon: <SwapIcon />, toneClass: "is-fx" };
  }
  if (/COMMISSION|FEE|TAX/.test(type)) {
    return { icon: <MinusIcon />, toneClass: "is-debit" };
  }
  if (/DEPOSIT/.test(type)) {
    return { icon: <DepositIcon />, toneClass: "is-credit" };
  }
  if (/WITHDRAWAL/.test(type)) {
    return { icon: <WithdrawalIcon />, toneClass: "is-debit" };
  }
  if (/DIVIDEND|INTEREST/.test(type)) {
    return { icon: <CoinIcon />, toneClass: "is-credit" };
  }
  return { icon: amount >= 0 ? <DepositIcon /> : <MinusIcon />, toneClass: amount >= 0 ? "is-credit" : "is-debit" };
}

// ---------------------------------------------------------------------------
// Small presentational atoms
// ---------------------------------------------------------------------------
function InfoIcon() {
  return (
    <svg aria-hidden="true" className="cash-info-icon" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.6v.05" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.3" viewBox="0 0 24 24" width="14">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="15">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Sparkline({ points, color, area }: { points: number[]; color: string; area?: boolean }) {
  const width = 120;
  const height = 44;
  const padY = 6;
  if (points.length < 2) {
    return null;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((value, index) => {
    const x = index * step;
    const y = padY + (height - padY * 2) * (1 - (value - min) / span);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const fillPath = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg aria-hidden="true" className="cash-spark" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
      {area ? <path d={fillPath} fill={color} fillOpacity="0.16" stroke="none" /> : null}
      <path d={line} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </svg>
  );
}

function DonutChart({ snapshots }: { snapshots: CurrencySnapshot[] }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  return (
    <svg aria-hidden="true" className="cash-donut" viewBox="0 0 140 140">
      <g transform="rotate(-90 70 70)">
        <circle cx="70" cy="70" fill="none" r={radius} stroke="var(--surface-hover)" strokeWidth="16" />
        {snapshots.map((snapshot) => {
          const dash = snapshot.share * circumference;
          const offset = -cumulative * circumference;
          cumulative += snapshot.share;
          return (
            <circle
              cx="70"
              cy="70"
              fill="none"
              key={snapshot.currency}
              r={radius}
              stroke={toneFor(snapshot.currency)}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={offset}
              strokeLinecap="butt"
              strokeWidth="16"
            />
          );
        })}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Illustration for the "Recent cash changes" narrative card
// ---------------------------------------------------------------------------
function CashChangesIllustration() {
  return (
    <svg aria-hidden="true" className="cash-changes-art" fill="none" viewBox="0 0 200 150">
      <circle cx="150" cy="96" fill="var(--accent)" fillOpacity="0.5" r="26" />
      <g stroke="var(--text)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4">
        <path d="M32 60l38-24 38 24" />
        <path d="M32 60h76" />
        <path d="M40 60v42M56 60v42M72 60v42M88 60v42M104 60v42" />
        <path d="M28 106h84" />
        <path d="M24 114h92" />
      </g>
      <g stroke="var(--text)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4">
        <rect fill="var(--surface)" height="34" rx="4" width="60" x="118" y="112" />
        <path d="M118 122h60" />
        <path d="M126 138h14" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
type CashFilterState = {
  currency: string;
  activityType: string;
  startDate: string;
  endDate: string;
};

const EMPTY_CASH_FILTERS: CashFilterState = {
  currency: "",
  activityType: "",
  startDate: "",
  endDate: "",
};

export function CashView() {
  const [timeseries, setTimeseries] = useState<CashBalanceTimeseriesResponse | null>(null);
  const [activities, setActivities] = useState<CashActivityListResponse | null>(null);
  const [syncLabel, setSyncLabel] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<CashFilterState>(EMPTY_CASH_FILTERS);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const [balanceHistory, activityFeed] = await Promise.all([
          api.cashBalanceTimeseries(),
          api.cashActivities(),
        ]);
        if (!active) {
          return;
        }
        if ((balanceHistory.items?.length ?? 0) === 0 && (activityFeed.items?.length ?? 0) === 0) {
          throw new Error("empty");
        }
        setTimeseries(balanceHistory);
        setActivities(activityFeed);
        setSyncLabel(null);
      } catch (caught) {
        if (!active) {
          return;
        }
        console.warn("Cash API unavailable, using demo data:", caught);
        setIsDemo(true);
        setTimeseries(DEMO_TIMESERIES);
        setActivities(DEMO_ACTIVITY_RESPONSE);
        setSyncLabel(DEMO_SYNC_LABEL);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const snapshots = useMemo(() => buildSnapshots(timeseries, isDemo), [timeseries, isDemo]);
  const totalUsd = useMemo(() => snapshots.reduce((sum, snapshot) => sum + snapshot.usdEquivalent, 0), [snapshots]);

  const allActivities = activities?.items ?? [];

  const currencyOptions = useMemo(
    () => Array.from(new Set(allActivities.map((a) => a.currency).filter(Boolean) as string[])).sort(),
    [allActivities],
  );
  const typeOptions = useMemo(
    () => Array.from(new Set(allActivities.map((a) => a.activity_type).filter(Boolean) as string[])).sort(),
    [allActivities],
  );

  const filteredActivities = useMemo(() => {
    return allActivities.filter((activity) => {
      if (filters.currency && (activity.currency ?? "").toUpperCase() !== filters.currency) {
        return false;
      }
      if (filters.activityType && (activity.activity_type ?? "").toUpperCase() !== filters.activityType) {
        return false;
      }
      const activityDate = activity.activity_date ?? activity.activity_datetime?.slice(0, 10) ?? "";
      if (filters.startDate && (!activityDate || activityDate < filters.startDate)) {
        return false;
      }
      if (filters.endDate && (!activityDate || activityDate > filters.endDate)) {
        return false;
      }
      return true;
    });
  }, [allActivities, filters]);

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const narrative = useMemo(() => buildNarrative(allActivities), [allActivities]);

  const activityStats = useMemo(() => {
    const total = activities?.total_count ?? allActivities.length;
    const byType = activities?.by_type ?? {};
    let deposits = 0;
    let feesCommissions = 0;
    Object.entries(byType).forEach(([type, count]) => {
      if (/DEPOSIT/i.test(type)) {
        deposits += count;
      }
      if (/COMMISSION|FEE|TAX/i.test(type)) {
        feesCommissions += count;
      }
    });
    return { total, deposits, feesCommissions };
  }, [activities, allActivities]);

  function handleRefresh() {
    if (!isDemo) {
      window.location.reload();
      return;
    }
    // Demo mode has nothing to refetch — flash the spinner for feedback only.
    setIsRefreshing(true);
    window.setTimeout(() => setIsRefreshing(false), 700);
  }

  const timelineActivities = showAllActivity ? filteredActivities : filteredActivities.slice(0, 6);

  if (isLoading) {
    return (
      <>
        <CashHeader syncLabel={null} onRefresh={handleRefresh} isRefreshing />
        <div className="panel-state cash-loading">
          <LoadingState message="Loading cash liquidity..." />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <CashHeader syncLabel={syncLabel} onRefresh={handleRefresh} isRefreshing={false} />
        <ErrorState message={error} title="Unable to load cash" />
      </>
    );
  }

  return (
    <>
      <CashHeader syncLabel={syncLabel} onRefresh={handleRefresh} isRefreshing={isRefreshing} />

      {/* Balance hero — total cash equivalent + per-currency split */}
      <section className="cash-hero" aria-label="Cash balances">
        <div className="cash-hero-total">
          <p className="cash-hero-amount">{formatUsd(totalUsd)}</p>
          <p className="cash-hero-label">
            Total cash equivalent
            <span className="cash-info-chip" title="Native balances converted to USD at latest reference FX rates.">
              <InfoIcon />
            </span>
          </p>
        </div>
        <div className="cash-hero-split">
          {snapshots.map((snapshot) => (
            <div className="cash-hero-cell" key={snapshot.currency}>
              <p className="cash-hero-cell-ccy">{snapshot.currency}</p>
              <p className="cash-hero-cell-value">{formatNative(snapshot.balance, snapshot.currency)}</p>
              <p className="cash-hero-cell-share">{formatPct(snapshot.share)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Liquidity snapshot cards */}
      <section className="cash-section" aria-label="Liquidity snapshot">
        <div className="cash-section-head">
          <h2>Liquidity snapshot</h2>
          <button className="cash-link" type="button" onClick={() => setFilterOpen(true)}>
            View all accounts <ArrowRightIcon />
          </button>
        </div>
        <div className="cash-snapshot-grid">
          {snapshots.map((snapshot) => (
            <article className="cash-snapshot-card" key={snapshot.currency}>
              <p className="cash-snapshot-title">{snapshot.currency} Cash</p>
              <p className="cash-snapshot-value">{formatNative(snapshot.balance, snapshot.currency)}</p>
              <div className="cash-snapshot-change">
                {snapshot.depositDelta !== null ? (
                  <>
                    <span className="cash-change-badge is-up">▲ +{Math.round(snapshot.depositDelta).toLocaleString()}</span>
                    <span className="cash-change-note">{snapshot.depositDateLabel ?? "recent deposit"}</span>
                  </>
                ) : snapshot.deltaPct !== null ? (
                  <>
                    <span className={`cash-change-badge${snapshot.deltaPct >= 0 ? " is-up" : " is-down"}`}>
                      {snapshot.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(Math.round(snapshot.deltaPct * 100))}%
                    </span>
                    <span className="cash-change-note">{snapshot.deltaPct >= 0 ? "higher than prior" : "lower than prior"}</span>
                  </>
                ) : (
                  <span className="cash-change-note">Stable this period</span>
                )}
              </div>
              <Sparkline points={snapshot.series} color={toneFor(snapshot.currency)} area={snapshot.isStep} />
            </article>
          ))}

          <article className="cash-snapshot-card cash-activity-card">
            <p className="cash-snapshot-title">Recent activity</p>
            <p className="cash-snapshot-value">{activityStats.total}</p>
            <ul className="cash-activity-breakdown">
              <li>
                <span className="cash-activity-dot is-credit" aria-hidden="true" />
                {activityStats.deposits} deposit{activityStats.deposits === 1 ? "" : "s"}
              </li>
              <li>
                <span className="cash-activity-dot is-debit" aria-hidden="true" />
                {activityStats.feesCommissions} fee{activityStats.feesCommissions === 1 ? "" : "s"} &amp; commissions
              </li>
            </ul>
          </article>
        </div>
      </section>

      {/* Narrative + allocation band */}
      <section className="cash-band" aria-label="Cash overview">
        <article className="cash-changes-card">
          <div className="cash-changes-art-wrap">
            <CashChangesIllustration />
          </div>
          <div className="cash-changes-body">
            <h3 className="cash-changes-title">Recent cash changes</h3>
            {narrative.map((line, index) => (
              <p className="cash-changes-line" key={index}>
                {line}
              </p>
            ))}
          </div>
        </article>

        <article className="cash-allocation-card">
          <h3 className="cash-allocation-title">
            Currency allocation
            <span className="cash-info-chip" title="Share of total USD-equivalent liquidity by currency.">
              <InfoIcon />
            </span>
          </h3>
          <div className="cash-allocation-body">
            <div className="cash-donut-wrap">
              <DonutChart snapshots={snapshots} />
            </div>
            <ul className="cash-allocation-legend">
              {snapshots.map((snapshot) => (
                <li className="cash-legend-row" key={snapshot.currency}>
                  <span className="cash-legend-dot" style={{ background: toneFor(snapshot.currency) }} aria-hidden="true" />
                  <span className="cash-legend-name">{snapshot.currency}</span>
                  <span className="cash-legend-pct">{formatPct(snapshot.share)}</span>
                  <span className="cash-legend-amount">{formatNative(snapshot.balance, snapshot.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="cash-allocation-total">
            <span>Total</span>
            <strong>{formatUsd(totalUsd)}</strong>
          </div>
        </article>
      </section>

      {/* Activity timeline */}
      <section className="cash-timeline-panel" aria-label="Activity timeline">
        <div className="cash-timeline-head">
          <h2>Activity timeline</h2>
          <button
            aria-expanded={filterOpen}
            className={`cash-filter-toggle${filterOpen ? " is-open" : ""}`}
            onClick={() => setFilterOpen((current) => !current)}
            type="button"
          >
            Filter
            <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="15">
              <path d="M4 5h16l-6 8v5l-4 2v-7z" />
            </svg>
          </button>
        </div>

        {filterOpen ? (
          <div className="cash-filter-bar">
            <label className="cash-filter-field">
              <span>Currency</span>
              <select
                onChange={(event) => setFilters((current) => ({ ...current, currency: event.target.value }))}
                value={filters.currency}
              >
                <option value="">All currencies</option>
                {currencyOptions.map((currency) => (
                  <option key={currency} value={currency.toUpperCase()}>
                    {currency}
                  </option>
                ))}
              </select>
              <ChevronIcon className="cash-filter-chevron" />
            </label>
            <label className="cash-filter-field">
              <span>Type</span>
              <select
                onChange={(event) => setFilters((current) => ({ ...current, activityType: event.target.value }))}
                value={filters.activityType}
              >
                <option value="">All types</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type.toUpperCase()}>
                    {formatActivityType(type)}
                  </option>
                ))}
              </select>
              <ChevronIcon className="cash-filter-chevron" />
            </label>
            <label className="cash-filter-field cash-filter-date">
              <span>Start date</span>
              <input
                max={filters.endDate || undefined}
                onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
                type="date"
                value={filters.startDate}
              />
            </label>
            <label className="cash-filter-field cash-filter-date">
              <span>End date</span>
              <input
                min={filters.startDate || undefined}
                onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
                type="date"
                value={filters.endDate}
              />
            </label>
            {hasActiveFilters ? (
              <button
                className="cash-filter-reset"
                onClick={() => setFilters(EMPTY_CASH_FILTERS)}
                type="button"
              >
                Reset
              </button>
            ) : null}
          </div>
        ) : null}

        {filteredActivities.length === 0 ? (
          <div className="panel-state">
            <p className="cash-empty">No cash movements match the selected filters.</p>
          </div>
        ) : (
          <ol className="cash-timeline">
            {timelineActivities.map((activity) => {
              const amount = decimalNumber(activity.amount) ?? 0;
              const visual = activityVisual(activity);
              const expanded = expandedId === activity.id;
              const dateLabel = activity.activity_datetime
                ? formatDisplayDateTime(activity.activity_datetime)
                : formatDisplayDate(activity.activity_date);

              return (
                <li className="cash-timeline-row" key={activity.id}>
                  <div className="cash-timeline-when">{dateLabel}</div>
                  <div className="cash-timeline-rail">
                    <span className={`cash-timeline-icon ${visual.toneClass}`} aria-hidden="true">
                      {visual.icon}
                    </span>
                  </div>
                  <div className={`cash-timeline-card${expanded ? " is-expanded" : ""}`}>
                    <button
                      aria-expanded={expanded}
                      className="cash-timeline-summary"
                      onClick={() => setExpandedId((current) => (current === activity.id ? null : activity.id))}
                      type="button"
                    >
                      <span className="cash-timeline-info">
                        <strong>{formatActivityType(activity.activity_type)}</strong>
                        <span className="cash-timeline-desc">{activity.description ?? activity.source_section ?? "—"}</span>
                      </span>
                      <span className={`cash-timeline-amount${amount > 0 ? " is-credit" : amount < 0 ? " is-debit" : ""}`}>
                        {formatSignedNative(amount, activity.currency)}
                      </span>
                      <span className="cash-ccy-badge">{(activity.currency ?? "—").toUpperCase()}</span>
                      <ChevronIcon className={`cash-timeline-chevron${expanded ? " is-open" : ""}`} />
                    </button>
                    {expanded ? (
                      <div className="cash-timeline-detail">
                        <div className="cash-detail-item">
                          <span>Source</span>
                          <strong>{activity.source_section ?? "—"}</strong>
                        </div>
                        <div className="cash-detail-item">
                          <span>Report date</span>
                          <strong>{formatDisplayDate(activity.report_date) || "—"}</strong>
                        </div>
                        <div className="cash-detail-item">
                          <span>Account</span>
                          <strong>{activity.account_id ?? "—"}</strong>
                        </div>
                        {activity.symbol ? (
                          <div className="cash-detail-item">
                            <span>Symbol</span>
                            <strong>{activity.symbol}</strong>
                          </div>
                        ) : null}
                        {activity.related_trade_id ? (
                          <div className="cash-detail-item">
                            <span>Trade ref</span>
                            <strong>{activity.related_trade_id}</strong>
                          </div>
                        ) : null}
                        {activity.fx_pair ? (
                          <div className="cash-detail-item">
                            <span>FX pair</span>
                            <strong>{activity.fx_pair}</strong>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {filteredActivities.length > 6 ? (
          <button className="cash-view-all" onClick={() => setShowAllActivity((current) => !current)} type="button">
            {showAllActivity ? "Show less" : "View all activity"} <ArrowRightIcon />
          </button>
        ) : null}
      </section>

      <div className="cash-footnote">
        <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="13">
          <rect height="10" rx="2" width="15" x="4.5" y="11" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <span>All currency values are converted to USD using latest FX rates.</span>
      </div>
    </>
  );
}

function CashHeader({
  syncLabel,
  onRefresh,
  isRefreshing,
}: {
  syncLabel: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <div className="page-header cash-hero-header">
      <div>
        <h1>Cash</h1>
        <p className="page-description">Liquidity across all accounts.</p>
      </div>
      <div className="cash-sync">
        {syncLabel ? (
          <div className="cash-sync-meta">
            <span className="cash-sync-label">Last synchronized</span>
            <span className="cash-sync-time">{syncLabel}</span>
          </div>
        ) : null}
        <button
          aria-label="Refresh cash data"
          className={`cash-refresh${isRefreshing ? " is-spinning" : ""}`}
          onClick={onRefresh}
          type="button"
        >
          <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
            <path d="M20 11a8 8 0 1 0-.9 4.5" />
            <path d="M20 5v6h-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
