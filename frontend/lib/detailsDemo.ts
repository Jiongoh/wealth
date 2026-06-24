import type {
  CurrentPosition,
  MarketCandle,
  MarketQuote,
  PositionLot,
  SymbolSearchResult,
} from "@/lib/api";

// SYNTHETIC_DATA_ONLY
// Sample ticker-details data used only when /details/[symbol] is opened with
// `?demo`. Every identifier and value below is intentionally fabricated and
// must never be replaced with account, brokerage, or production-derived data.

const SYMBOL = "DEMO";

const symbolInfo: SymbolSearchResult = {
  symbol: SYMBOL,
  name: "Synthetic Preview Holdings",
  exchange: "TEST",
  is_etf: false,
  source_file: "synthetic-fixture",
};

const position: CurrentPosition = {
  symbol: SYMBOL,
  conid: "demo-contract-001",
  total_quantity: "12.0000000000",
  current_price: "25.0000000000",
  avg_cost: "20.0000000000",
  market_value: "300.0000000000",
  unrealized_pnl: "60.0000000000",
  unrealized_pnl_pct: "0.2500000000",
  weight_pct: "5.0000000000",
};

const lots: PositionLot[] = [
  {
    report_date: "2025-01-31",
    account_id: "DEMO",
    currency: "USD",
    asset_class: "STK",
    symbol: SYMBOL,
    description: "SYNTHETIC PREVIEW HOLDINGS",
    conid: "demo-contract-001",
    quantity: "3.0000000000",
    mark_price: "25.0000000000",
    position_value: "75.0000000000",
    open_price: "18.0000000000",
    cost_basis_price: "18.0000000000",
    cost_basis_money: "54.0000000000",
    unrealized_pnl: "21.0000000000",
    side: "Long",
    level_of_detail: "LOT",
    open_datetime: "2025-01-06T10:00:00Z",
    holding_period_datetime: "2025-01-06T10:00:00Z",
    originating_order_id: "demo-order-001",
    originating_transaction_id: "demo-transaction-001",
  },
  {
    report_date: "2025-01-31",
    account_id: "DEMO",
    currency: "USD",
    asset_class: "STK",
    symbol: SYMBOL,
    description: "SYNTHETIC PREVIEW HOLDINGS",
    conid: "demo-contract-001",
    quantity: "3.0000000000",
    mark_price: "25.0000000000",
    position_value: "75.0000000000",
    open_price: "19.0000000000",
    cost_basis_price: "19.0000000000",
    cost_basis_money: "57.0000000000",
    unrealized_pnl: "18.0000000000",
    side: "Long",
    level_of_detail: "LOT",
    open_datetime: "2025-01-10T10:00:00Z",
    holding_period_datetime: "2025-01-10T10:00:00Z",
    originating_order_id: "demo-order-002",
    originating_transaction_id: "demo-transaction-002",
  },
  {
    report_date: "2025-01-31",
    account_id: "DEMO",
    currency: "USD",
    asset_class: "STK",
    symbol: SYMBOL,
    description: "SYNTHETIC PREVIEW HOLDINGS",
    conid: "demo-contract-001",
    quantity: "3.0000000000",
    mark_price: "25.0000000000",
    position_value: "75.0000000000",
    open_price: "21.0000000000",
    cost_basis_price: "21.0000000000",
    cost_basis_money: "63.0000000000",
    unrealized_pnl: "12.0000000000",
    side: "Long",
    level_of_detail: "LOT",
    open_datetime: "2025-01-15T10:00:00Z",
    holding_period_datetime: "2025-01-15T10:00:00Z",
    originating_order_id: "demo-order-003",
    originating_transaction_id: "demo-transaction-003",
  },
  {
    report_date: "2025-01-31",
    account_id: "DEMO",
    currency: "USD",
    asset_class: "STK",
    symbol: SYMBOL,
    description: "SYNTHETIC PREVIEW HOLDINGS",
    conid: "demo-contract-001",
    quantity: "3.0000000000",
    mark_price: "25.0000000000",
    position_value: "75.0000000000",
    open_price: "22.0000000000",
    cost_basis_price: "22.0000000000",
    cost_basis_money: "66.0000000000",
    unrealized_pnl: "9.0000000000",
    side: "Long",
    level_of_detail: "LOT",
    open_datetime: "2025-01-20T10:00:00Z",
    holding_period_datetime: "2025-01-20T10:00:00Z",
    originating_order_id: "demo-order-004",
    originating_transaction_id: "demo-transaction-004",
  },
];

const quote: MarketQuote = {
  symbol: SYMBOL,
  provider: "alpaca",
  active_provider: "alpaca",
  active_feed: "overnight",
  feed: "overnight",
  market_session: "overnight",
  last_price: "25.00000000",
  bid_price: "24.95000000",
  ask_price: "25.05000000",
  bid_ask_provider: "alpaca",
  bid_ask_feed: "overnight",
  bid_ask_timestamp: "2025-01-31T10:00:00Z",
  bid_ask_stale_seconds: 0,
  last_bar_close: "25.00000000",
  previous_close: "24.50",
  source_timestamp: "2025-01-31T10:00:00Z",
  updated_at: "2025-01-31T10:00:01Z",
  data_source: "websocket",
  is_stale: false,
  stale_seconds: 0,
  status_label: "realtime",
  reason: "20:00-04:00 ET uses Alpaca overnight",
};

// A deterministic, gently noisy overnight price path so the Price Journey chart
// renders a believable night session. Built relative to "now" so it fills the
// default 1-hour window regardless of when the preview is opened.
function buildDemoCandles(): MarketCandle[] {
  const points = 64;
  const stepMs = 60_000;
  const now = Date.now();
  // Shape: opens near 23, rises toward 27, then drifts back toward 25.
  const path: number[] = [];
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1);
    const arc = Math.sin(t * Math.PI) * 3.5;
    const drift = t * 2;
    const wobble = Math.sin(i * 1.7) * 0.25 + Math.sin(i * 0.6) * 0.15;
    path.push(23 + arc + drift + wobble);
  }
  // Pin the final close to the live last price for continuity with the quote.
  path[points - 1] = 25;

  return path.map((close, i) => {
    const ts = new Date(now - (points - 1 - i) * stepMs).toISOString();
    const prev = i === 0 ? close : path[i - 1];
    const open = prev;
    const high = Math.max(open, close) + 0.6;
    const low = Math.min(open, close) - 0.6;
    return {
      symbol: SYMBOL,
      provider: "alpaca",
      feed: "overnight",
      timeframe: "1m",
      timestamp: ts,
      open: open.toFixed(2),
      high: high.toFixed(2),
      low: low.toFixed(2),
      close: close.toFixed(2),
      volume: String(120 + ((i * 37) % 240)),
      vwap: close.toFixed(2),
    } satisfies MarketCandle;
  });
}

export const DETAILS_DEMO = {
  symbol: SYMBOL,
  symbolInfo,
  position,
  lots,
  quote,
  candles: buildDemoCandles(),
};
