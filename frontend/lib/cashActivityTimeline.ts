import type { CashActivity } from "./api";

export type CashTimelineEntry = {
  activity: CashActivity;
  fxCounterpart: CashActivity | null;
  commission: CashActivity | null;
};

export type CashTimelineFilters = {
  currency: string;
  activityType: string;
  startDate: string;
  endDate: string;
};

function fxExecutionKey(activity: CashActivity): string | null {
  if (
    activity.activity_type !== "FX_CONVERSION" ||
    activity.source_section !== "TRADES" ||
    !activity.related_trade_id ||
    !activity.fx_pair ||
    !activity.currency ||
    activity.amount === null
  ) {
    return null;
  }

  const currencies = activity.fx_pair.split(".");
  const amount = Number(activity.amount);
  if (currencies.length !== 2 || !currencies.includes(activity.currency) || !Number.isFinite(amount) || amount === 0) {
    return null;
  }

  return JSON.stringify([
    activity.account_id,
    activity.related_trade_id,
    activity.fx_pair,
    activity.activity_date,
    activity.activity_datetime,
  ]);
}

function stockExecutionKey(activity: CashActivity): string | null {
  if (
    !["STOCK_BUY", "STOCK_SELL", "COMMISSION"].includes(activity.activity_type ?? "") ||
    activity.source_section !== "TRADES" ||
    !activity.related_trade_id ||
    !activity.symbol ||
    !activity.currency ||
    activity.amount === null ||
    !Number.isFinite(Number(activity.amount)) ||
    Number(activity.amount) === 0
  ) {
    return null;
  }

  return JSON.stringify([
    activity.account_id,
    activity.related_trade_id,
    activity.symbol,
    activity.activity_date,
    activity.activity_datetime,
  ]);
}

export function buildCashTimelineEntries(activities: CashActivity[]): CashTimelineEntry[] {
  const entries: CashTimelineEntry[] = [];
  const unpairedFx = new Map<string, CashTimelineEntry[]>();
  const unpairedStock = new Map<string, CashTimelineEntry[]>();

  for (const activity of activities) {
    const key = fxExecutionKey(activity);
    if (key) {
      const candidates = unpairedFx.get(key) ?? [];
      const matchIndex = candidates.findIndex(({ activity: other }) =>
        other.currency !== activity.currency && Number(other.amount) * Number(activity.amount) < 0,
      );
      if (matchIndex !== -1) {
        candidates[matchIndex].fxCounterpart = activity;
        candidates.splice(matchIndex, 1);
        continue;
      }
      const entry = { activity, fxCounterpart: null, commission: null };
      entries.push(entry);
      candidates.push(entry);
      unpairedFx.set(key, candidates);
      continue;
    }

    const stockKey = stockExecutionKey(activity);
    if (stockKey) {
      const candidates = unpairedStock.get(stockKey) ?? [];
      const matchIndex = candidates.findIndex(({ activity: other }) =>
        (activity.activity_type === "COMMISSION") !== (other.activity_type === "COMMISSION"),
      );
      if (matchIndex !== -1) {
        const entry = candidates[matchIndex];
        if (activity.activity_type === "COMMISSION") {
          entry.commission = activity;
        } else {
          entry.commission = entry.activity;
          entry.activity = activity;
        }
        candidates.splice(matchIndex, 1);
        continue;
      }
      const entry = { activity, fxCounterpart: null, commission: null };
      entries.push(entry);
      candidates.push(entry);
      unpairedStock.set(stockKey, candidates);
      continue;
    }

    entries.push({ activity, fxCounterpart: null, commission: null });
  }

  return entries;
}

export function filterCashTimelineEntries(entries: CashTimelineEntry[], filters: CashTimelineFilters): CashTimelineEntry[] {
  return entries.filter(({ activity, fxCounterpart, commission }) => {
    const legs = [activity, fxCounterpart, commission].filter((leg): leg is CashActivity => leg !== null);
    if (filters.currency && !legs.some((leg) => (leg.currency ?? "").toUpperCase() === filters.currency)) {
      return false;
    }
    if (filters.activityType && !legs.some((leg) => (leg.activity_type ?? "").toUpperCase() === filters.activityType)) {
      return false;
    }
    return legs.some((leg) => {
      const activityDate = leg.activity_date ?? leg.activity_datetime?.slice(0, 10) ?? "";
      if (filters.startDate && (!activityDate || activityDate < filters.startDate)) {
        return false;
      }
      if (filters.endDate && (!activityDate || activityDate > filters.endDate)) {
        return false;
      }
      return true;
    });
  });
}
