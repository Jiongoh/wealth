export type DecimalValue = number | string | null;

export type DateRange = {
  start_date?: string;
  end_date?: string;
};

export type PortfolioSummary = {
  report_date: string;
  total_nav: DecimalValue;
  cash: DecimalValue;
  stock: DecimalValue;
  unrealized_pnl: DecimalValue;
  currency: string | null;
};

export type NavDaily = {
  report_date: string | null;
  account_id: string | null;
  currency: string | null;
  cash: DecimalValue;
  stock: DecimalValue;
  options: DecimalValue;
  funds: DecimalValue;
  dividend_accruals: DecimalValue;
  interest_accruals: DecimalValue;
  broker_interest_accruals_component: DecimalValue;
  margin_financing_charge_accruals: DecimalValue;
  crypto: DecimalValue;
  total: DecimalValue;
};

export type PortfolioPerformanceDaily = {
  date: string;
  currency: string | null;
  nav: DecimalValue;
  previous_date: string | null;
  previous_nav: DecimalValue;
  external_cash_flow: DecimalValue;
  performance_amount: DecimalValue;
  performance_pct: DecimalValue;
};

export type RealizedPnlSummary = {
  total_realized_pnl: DecimalValue;
  currency: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type RealizedPnlDaily = {
  date: string;
  currency: string | null;
  realized_pnl: DecimalValue;
  trade_count: number;
};

export type RealizedPnlBySymbol = {
  symbol: string | null;
  conid: string | null;
  currency: string | null;
  realized_pnl: DecimalValue;
  trade_count: number;
};

export type WatchlistItem = {
  id: number;
  symbol: string;
  display_name: string | null;
  notes: string | null;
  realtime_enabled: boolean;
  tags: string[];
  has_position: boolean;
  latest_report_date: string | null;
  position_quantity: DecimalValue;
  current_price: DecimalValue;
  market_value: DecimalValue;
  unrealized_pnl: DecimalValue;
  updated_at: string;
};

export type WatchlistTag = {
  id: number;
  name: string;
  count: number;
  color: string | null;
};

export type WatchlistPayload = {
  symbol?: string;
  tags?: string[];
  display_name?: string | null;
  notes?: string | null;
  realtime_enabled?: boolean;
};

export type SymbolSearchResult = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  is_etf: boolean | null;
  source_file: string | null;
};

export type CurrentPosition = {
  symbol: string | null;
  conid: string | null;
  total_quantity: DecimalValue;
  current_price: DecimalValue;
  avg_cost: DecimalValue;
  market_value: DecimalValue;
  unrealized_pnl: DecimalValue;
  unrealized_pnl_pct: DecimalValue;
  weight_pct: DecimalValue;
};

export type PositionLot = {
  report_date: string | null;
  account_id: string | null;
  currency: string | null;
  asset_class: string | null;
  symbol: string | null;
  description: string | null;
  conid: string | null;
  quantity: DecimalValue;
  mark_price: DecimalValue;
  position_value: DecimalValue;
  open_price: DecimalValue;
  cost_basis_price: DecimalValue;
  cost_basis_money: DecimalValue;
  unrealized_pnl: DecimalValue;
  side: string | null;
  level_of_detail: string | null;
  open_datetime: string | null;
  holding_period_datetime: string | null;
  originating_order_id: string | null;
  originating_transaction_id: string | null;
};

export type LotAnalysis = {
  report_date: string | null;
  account_id: string | null;
  symbol: string | null;
  conid: string | null;
  total_quantity: DecimalValue;
  current_price: DecimalValue;
  total_cost_basis_money: DecimalValue;
  avg_cost: DecimalValue;
  unrealized_pnl: DecimalValue;
  highest_cost_lot_quantity: DecimalValue;
  highest_cost_lot_price: DecimalValue;
  highest_cost_lot_cost_basis_money: DecimalValue;
  highest_cost_lot_open_datetime: string | null;
  highest_cost_lot_profit_pct: DecimalValue;
  highest_cost_lot_profit_over_20: boolean | null;
  avg_cost_without_highest_lot: DecimalValue;
  remaining_quantity_without_highest_lot: DecimalValue;
  remaining_cost_without_highest_lot: DecimalValue;
};

export type Trade = {
  report_date: string | null;
  account_id: string | null;
  currency: string | null;
  asset_class: string | null;
  symbol: string | null;
  description: string | null;
  conid: string | null;
  datetime: string | null;
  trade_date: string | null;
  settle_date: string | null;
  transaction_type: string | null;
  exchange: string | null;
  quantity: DecimalValue;
  trade_price: DecimalValue;
  trade_money: DecimalValue;
  proceeds: DecimalValue;
  taxes: DecimalValue;
  ib_commission: DecimalValue;
  ib_commission_currency: string | null;
  net_cash: DecimalValue;
  open_close_indicator: string | null;
  cost_basis: DecimalValue;
  realized_pnl: DecimalValue;
  mtm_pnl: DecimalValue;
  buy_sell: string | null;
  order_id: string | null;
  transaction_id: string | null;
  ib_execution_id: string | null;
  ib_order_id: string | null;
  orig_order_id: string | null;
  orig_trade_price: DecimalValue;
  orig_trade_date: string | null;
  orig_trade_id: string | null;
  open_datetime: string | null;
  level_of_detail: string | null;
};

export type TradeListResponse = {
  items: Trade[];
  total_count: number;
  buy_count: number;
  sell_count: number;
  symbol_filter: string;
};

export type CashReport = {
  report_date: string | null;
  account_id: string | null;
  currency: string | null;
  level_of_detail: string | null;
  from_date: string | null;
  to_date: string | null;
  starting_cash: DecimalValue;
  deposits: DecimalValue;
  withdrawals: DecimalValue;
  deposit_withdrawals: DecimalValue;
  dividends: DecimalValue;
  broker_interest_paid_received: DecimalValue;
  commissions: DecimalValue;
  net_trades_sales: DecimalValue;
  net_trades_purchases: DecimalValue;
  withholding_tax: DecimalValue;
  transaction_tax: DecimalValue;
  fx_translation_gain_loss: DecimalValue;
  other_fees: DecimalValue;
  other_income: DecimalValue;
  other: DecimalValue;
  ending_cash: DecimalValue;
  ending_settled_cash: DecimalValue;
};

export type CashBalancePoint = {
  date: string;
  currency: string;
  balance: DecimalValue;
};

export type CashBalanceTimeseriesResponse = {
  items: CashBalancePoint[];
  currencies: string[];
};

export type CashActivity = {
  id: number;
  report_date: string | null;
  activity_date: string | null;
  activity_datetime: string | null;
  account_id: string | null;
  currency: string | null;
  amount: DecimalValue;
  activity_type: string | null;
  description: string | null;
  source_section: string | null;
  symbol: string | null;
  fx_pair: string | null;
  related_trade_id: string | null;
  external_id: string | null;
};

export type CashActivityListResponse = {
  items: CashActivity[];
  total_count: number;
  by_type: Record<string, number>;
};

export type SyncRun = {
  id: number;
  job_key: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  duration_ms: number | null;
  rows_total: number | null;
  rows_inserted: number | null;
  rows_updated: number | null;
  rows_deleted: number | null;
  artifact_path: string | null;
  error_message: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  message: string | null;
  report_date: string | null;
  raw_flex_report_id: number | null;
};

export type RawFlexReport = {
  id: number;
  report_date: string | null;
  query_id: string;
  xml_path: string;
  xml_sha256: string;
  downloaded_at: string;
  status: string;
  error_message: string | null;
};

export type SyncStatus = {
  latest_run: SyncRun | null;
  latest_raw_flex_report: RawFlexReport | null;
};

export type SyncJob = {
  job_key: string;
  display_name: string | null;
  enabled: boolean;
  use_shared_schedule: boolean;
  schedule_type: string | null;
  daily_sync_time: string | null;
  weekdays_only: boolean | null;
  cron_expression: string | null;
  timezone: string | null;
  last_auto_sync_date: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
};

export type SyncSchedule = {
  daily_sync_time: string;
  timezone_name: string;
  weekdays_only: boolean;
  last_auto_sync_date: string | null;
  updated_at: string;
};

export type MarketQuote = {
  symbol: string;
  provider: string;
  active_provider?: string | null;
  active_feed?: string | null;
  feed: string;
  market_session: string | null;
  last_price: DecimalValue;
  bid_price: DecimalValue;
  ask_price: DecimalValue;
  bid_ask_provider?: string | null;
  bid_ask_feed?: string | null;
  bid_ask_timestamp?: string | null;
  bid_ask_stale_seconds?: number | null;
  last_bar_close: DecimalValue;
  source_timestamp?: string | null;
  updated_at: string;
  data_source?: string | null;
  is_stale?: boolean;
  stale_seconds?: number | null;
  status_label?: string | null;
  reason?: string | null;
};

export type MarketCandle = {
  symbol: string;
  provider: string;
  feed: string;
  timeframe: string;
  timestamp: string;
  open: DecimalValue;
  high: DecimalValue;
  low: DecimalValue;
  close: DecimalValue;
  volume: DecimalValue;
  vwap: DecimalValue;
};

export type MarketProviderStatus = {
  provider: string;
  feed: string;
  status: string;
  connected_at: string | null;
  disconnected_at: string | null;
  last_message_at: string | null;
  message_count: number;
  subscribed_symbols: string[] | null;
  subscribed_count: number;
  error_message: string | null;
  updated_at: string;
};

export type MarketSubscriptionPlan = {
  symbols: string[];
  max_symbols: number;
  total_candidates: number;
  subscribed_count: number;
  overflow_count: number;
  holdings_count: number;
  watchlist_realtime_count: number;
  excluded_symbols: string[];
  warnings: string[];
};

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const API_BASE_URL = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api");

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "") || "/api";
}

function withQuery(path: string, params?: Record<string, string | number | undefined>): string {
  if (!params) {
    return path;
  }

  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  });

  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set("Accept", "application/json");
  if (options?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { detail?: string; error?: { message?: string } }
      | null;
    const message = body?.detail ?? body?.error?.message ?? `Request failed with status ${response.status}.`;
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ status: string }>("/health"),
  portfolioSummary: () => request<PortfolioSummary | null>("/portfolio/summary"),
  navHistory: (range: DateRange = {}) =>
    request<NavDaily[]>(withQuery("/portfolio/nav/history", { ...range })),
  portfolioPerformanceDaily: (range: DateRange = {}) =>
    request<PortfolioPerformanceDaily[]>(withQuery("/portfolio/performance/daily", { ...range })),
  realizedPnlSummary: () => request<RealizedPnlSummary>("/pnl/realized/summary"),
  realizedPnlDaily: (filters: DateRange & { symbol?: string } = {}) =>
    request<RealizedPnlDaily[]>(withQuery("/pnl/realized/daily", { ...filters })),
  realizedPnlBySymbol: (range: DateRange = {}) =>
    request<RealizedPnlBySymbol[]>(withQuery("/pnl/realized/by-symbol", { ...range })),
  watchlist: (params: { tag?: string; q?: string } = {}) =>
    request<WatchlistItem[]>(withQuery("/watchlist", { ...params })),
  searchSymbols: (params: { q: string; limit?: number }, options?: RequestInit) =>
    request<SymbolSearchResult[]>(withQuery("/symbols/search", { ...params }), options),
  createWatchlistTicker: (payload: WatchlistPayload & { symbol: string }) =>
    request<WatchlistItem>("/watchlist", { method: "POST", body: JSON.stringify(payload) }),
  updateWatchlistTicker: (symbol: string, payload: WatchlistPayload) =>
    request<WatchlistItem>(`/watchlist/${encodeURIComponent(symbol)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteWatchlistTicker: (symbol: string) =>
    request<void>(`/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" }),
  watchlistTags: () => request<WatchlistTag[]>("/watchlist/tags"),
  createWatchlistTags: (names: string[]) =>
    request<WatchlistTag[]>("/watchlist/tags", { method: "POST", body: JSON.stringify({ names }) }),
  updateWatchlistTag: (tagId: number, payload: { name: string }) =>
    request<WatchlistTag>(`/watchlist/tags/${tagId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteWatchlistTag: (tagId: number) =>
    request<{ success: boolean }>(`/watchlist/tags/${tagId}`, { method: "DELETE" }),
  positions: () => request<CurrentPosition[]>("/positions/current"),
  lots: (symbol?: string) => request<PositionLot[]>(withQuery("/positions/lots", { symbol })),
  lotAnalysis: () => request<LotAnalysis[]>("/positions/lots/analysis"),
  marketStatus: () => request<MarketProviderStatus[]>("/market/status"),
  marketQuotes: () => request<MarketQuote[]>("/market/quotes"),
  marketQuote: (symbol: string) =>
    request<MarketQuote | null>(`/market/quotes/${encodeURIComponent(symbol)}`, { cache: "no-store" }),
  marketCandles: (symbol: string, params: { timeframe?: string; range?: string } = {}) =>
    request<MarketCandle[]>(
      withQuery(`/market/candles/${encodeURIComponent(symbol)}`, {
        timeframe: params.timeframe ?? "1m",
        range: params.range ?? "1h",
      }),
      { cache: "no-store" },
    ),
  marketSubscriptionPlan: () =>
    request<MarketSubscriptionPlan>("/market/subscriptions/preview", { cache: "no-store" }),
  trades: (filters: DateRange & { symbol?: string; limit?: number } = {}) =>
    request<TradeListResponse>(withQuery("/trades", { ...filters })),
  cashActivities: (filters: DateRange & { currency?: string; activity_type?: string } = {}) =>
    request<CashActivityListResponse>(withQuery("/cash/activities", { ...filters })),
  cashBalanceTimeseries: (filters: DateRange & { currency?: string } = {}) =>
    request<CashBalanceTimeseriesResponse>(withQuery("/cash/balances/timeseries", { ...filters })),
  cashHistory: (filters: DateRange & { currency?: string } = {}) =>
    request<CashReport[]>(withQuery("/cash/history", { ...filters })),
  syncStatus: () => request<SyncStatus>("/sync/status"),
  syncJobs: () => request<SyncJob[]>("/sync/jobs"),
  syncJobRuns: (jobKey: string, params: { limit?: number } = {}) =>
    request<SyncRun[]>(withQuery(`/sync/jobs/${encodeURIComponent(jobKey)}/runs`, { ...params })),
  syncSchedule: () => request<SyncSchedule>("/sync/schedule"),
  updateSyncSchedule: (payload: { daily_sync_time: string; timezone_name?: string; weekdays_only: boolean }) =>
    request<SyncSchedule>("/sync/schedule", { method: "PUT", body: JSON.stringify(payload) }),
  updateSyncJobSchedule: (
    jobKey: string,
    payload: {
      enabled?: boolean;
      use_shared_schedule: boolean;
      daily_sync_time?: string | null;
      timezone?: string | null;
      weekdays_only?: boolean | null;
    },
  ) =>
    request<SyncJob>(`/sync/jobs/${encodeURIComponent(jobKey)}/schedule`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  runSyncJob: (jobKey: string) =>
    request<SyncRun>(`/sync/jobs/${encodeURIComponent(jobKey)}/run`, { method: "POST" }),
  runSync: () => request<SyncRun>("/sync/run", { method: "POST" }),
};
