import type {
  CurrentPosition,
  MarketCandle,
  MarketQuote,
  PositionLot,
  SymbolSearchResult,
} from "@/lib/api";

// Sample ticker-details data used only when /details/[symbol] is opened with
// `?demo` (e.g. previewing the editorial layout locally without a running
// backend). The numbers are real LITE values pulled from the server database
// so the preview reflects an actual position rather than fabricated figures.

const SYMBOL = "LITE";

const symbolInfo: SymbolSearchResult = {
  symbol: SYMBOL,
  name: "Lumentum Holdings Inc. - Common Stock",
  exchange: "NASDAQ",
  is_etf: false,
  source_file: "nasdaqlisted.txt",
};

const position: CurrentPosition = {
  symbol: SYMBOL,
  conid: "201113895",
  total_quantity: "0.4060000000",
  current_price: "846.0000000000",
  avg_cost: "916.4653029557",
  market_value: "343.4760000000",
  unrealized_pnl: "-28.6093130000",
  unrealized_pnl_pct: "-0.07687648943",
  weight_pct: "0.5613155597",
};

const lots: PositionLot[] = [
  {
    report_date: "2026-06-19",
    account_id: "DEMO",
    currency: "USD",
    asset_class: "STK",
    symbol: SYMBOL,
    description: "LUMENTUM HOLDINGS INC",
    conid: "201113895",
    quantity: "0.1000000000",
    mark_price: "846.0000000000",
    position_value: "84.6000000000",
    open_price: "1001.2127800000",
    cost_basis_price: "1001.2127800000",
    cost_basis_money: "100.1212780000",
    unrealized_pnl: "-15.5212780000",
    side: "Long",
    level_of_detail: "LOT",
    open_datetime: "2026-05-12T10:50:59Z",
    holding_period_datetime: "2026-05-12T10:50:59Z",
    originating_order_id: "5177550480",
    originating_transaction_id: "39868080725",
  },
  {
    report_date: "2026-06-19",
    account_id: "DEMO",
    currency: "USD",
    asset_class: "STK",
    symbol: SYMBOL,
    description: "LUMENTUM HOLDINGS INC",
    conid: "201113895",
    quantity: "0.1000000000",
    mark_price: "846.0000000000",
    position_value: "84.6000000000",
    open_price: "928.3627800000",
    cost_basis_price: "928.3627800000",
    cost_basis_money: "92.8362780000",
    unrealized_pnl: "-8.2362780000",
    side: "Long",
    level_of_detail: "LOT",
    open_datetime: "2026-05-15T09:58:26Z",
    holding_period_datetime: "2026-05-15T09:58:26Z",
    originating_order_id: "5193565259",
    originating_transaction_id: "39967267116",
  },
  {
    report_date: "2026-06-19",
    account_id: "DEMO",
    currency: "USD",
    asset_class: "STK",
    symbol: SYMBOL,
    description: "LUMENTUM HOLDINGS INC",
    conid: "201113895",
    quantity: "0.0900000000",
    mark_price: "846.0000000000",
    position_value: "76.1400000000",
    open_price: "878.6119555560",
    cost_basis_price: "878.6119555560",
    cost_basis_money: "79.0750760000",
    unrealized_pnl: "-2.9350760000",
    side: "Long",
    level_of_detail: "LOT",
    open_datetime: "2026-05-18T10:33:29Z",
    holding_period_datetime: "2026-05-18T10:33:29Z",
    originating_order_id: "5200151016",
    originating_transaction_id: "40006888065",
  },
  {
    report_date: "2026-06-19",
    account_id: "DEMO",
    currency: "USD",
    asset_class: "STK",
    symbol: SYMBOL,
    description: "LUMENTUM HOLDINGS INC",
    conid: "201113895",
    quantity: "0.1160000000",
    mark_price: "846.0000000000",
    position_value: "98.1360000000",
    open_price: "862.5196637930",
    cost_basis_price: "862.5196637930",
    cost_basis_money: "100.0522810000",
    unrealized_pnl: "-1.9162810000",
    side: "Long",
    level_of_detail: "LOT",
    open_datetime: "2026-05-28T14:53:50Z",
    holding_period_datetime: "2026-05-28T14:53:50Z",
    originating_order_id: "5240204045",
    originating_transaction_id: "40256861811",
  },
];

const quote: MarketQuote = {
  symbol: SYMBOL,
  provider: "alpaca",
  active_provider: "alpaca",
  active_feed: "overnight",
  feed: "overnight",
  market_session: "overnight",
  last_price: "846.00000000",
  bid_price: "845.22000000",
  ask_price: "847.05000000",
  bid_ask_provider: "alpaca",
  bid_ask_feed: "overnight",
  bid_ask_timestamp: "2026-06-22T07:29:08.693472Z",
  bid_ask_stale_seconds: 0,
  last_bar_close: "846.00000000",
  previous_close: "889.28",
  source_timestamp: "2026-06-22T07:29:08.693472Z",
  updated_at: "2026-06-22T07:29:08.723063Z",
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
  // Shape: opens near 843, climbs to ~859, then drifts back toward 846.
  const path: number[] = [];
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1);
    const arc = Math.sin(t * Math.PI) * 14; // rise then fall
    const drift = -t * 1.5;
    const wobble = Math.sin(i * 1.7) * 1.4 + Math.sin(i * 0.6) * 0.9;
    path.push(843 + arc + drift + wobble);
  }
  // Pin the final close to the live last price for continuity with the quote.
  path[points - 1] = 846;

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
