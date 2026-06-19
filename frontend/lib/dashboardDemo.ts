import type {
  CashActivity,
  NavDaily,
  PortfolioPerformanceDaily,
  PortfolioSummary,
  RealizedPnlDaily,
  RealizedPnlSummary,
  Trade,
} from "@/lib/api";

// Sample data used only when the dashboard is opened with `?demo=1`.
// It mirrors the reference mockup so the editorial layout can be previewed
// locally without a running backend. The real `/` route uses the live API.

const CURRENCY = "USD";

const summary: PortfolioSummary = {
  report_date: "2026-06-16",
  total_nav: 966.29,
  cash: 355.69,
  stock: 610.6,
  unrealized_pnl: 84.21,
  currency: CURRENCY,
};

const navSeries: Array<[string, number]> = [
  ["2026-05-21", 728.5],
  ["2026-05-23", 735.1],
  ["2026-05-25", 752.4],
  ["2026-05-27", 880.2],
  ["2026-05-29", 902.7],
  ["2026-06-01", 868.4],
  ["2026-06-02", 884.9],
  ["2026-06-03", 857.5],
  ["2026-06-04", 860.0],
  ["2026-06-05", 815.2],
  ["2026-06-08", 839.9],
  ["2026-06-09", 810.8],
  ["2026-06-10", 803.5],
  ["2026-06-11", 825.1],
  ["2026-06-12", 837.4],
  ["2026-06-15", 1010.6],
  ["2026-06-16", 966.29],
  ["2026-06-18", 1102.4],
];

const navHistory: NavDaily[] = navSeries.map(([report_date, total]) => ({
  report_date,
  account_id: "DEMO",
  currency: CURRENCY,
  cash: null,
  stock: null,
  options: null,
  funds: null,
  dividend_accruals: null,
  interest_accruals: null,
  broker_interest_accruals_component: null,
  margin_financing_charge_accruals: null,
  crypto: null,
  total,
}));

const perfSeries: Array<[string, number, number]> = [
  ["2026-05-26", 14.82, 0.0185],
  ["2026-05-27", -2.66, -0.0033],
  ["2026-05-28", -11.1, -0.0137],
  ["2026-05-29", -1.66, -0.0021],
  ["2026-06-01", 21.23, 0.0266],
  ["2026-06-02", 15.05, 0.0621],
  ["2026-06-03", -27.34, -0.0219],
  ["2026-06-04", 2.1, 0.0025],
  ["2026-06-05", -44.8, -0.0536],
  ["2026-06-08", 24.69, 0.031],
  ["2026-06-09", -29.04, -0.0484],
  ["2026-06-10", 8.42, 0.0103],
  ["2026-06-11", 21.53, 0.0237],
  ["2026-06-12", 12.29, 0.0128],
  ["2026-06-15", 30.71, 0.0314],
  ["2026-06-16", -43.26, -0.0429],
];

// Native-currency external cash flows by date (no FX conversion). The June 10
// CNH deposit demonstrates a foreign-currency flow that is not converted.
const externalCashFlowsByDate: Record<string, { currency: string; amount: number }[]> = {
  "2026-06-10": [{ currency: "CNH", amount: 1000 }],
};

const performanceDaily: PortfolioPerformanceDaily[] = perfSeries.map(
  ([date, performance_amount, performance_pct]) => ({
    date,
    currency: CURRENCY,
    nav: null,
    previous_date: null,
    previous_nav: null,
    external_cash_flow: 0,
    external_cash_flows: externalCashFlowsByDate[date] ?? [],
    performance_amount,
    performance_pct,
  }),
);

const realizedSummary: RealizedPnlSummary = {
  total_realized_pnl: 37.07,
  currency: CURRENCY,
  start_date: "2026-05-26",
  end_date: "2026-05-26",
};

const realizedDaily: RealizedPnlDaily[] = [
  { date: "2026-05-26", currency: CURRENCY, realized_pnl: 37.07, trade_count: 2 },
];

const trades: Trade[] = [
  {
    report_date: "2026-06-15",
    account_id: "DEMO",
    currency: CURRENCY,
    asset_class: "STK",
    symbol: "NVDA",
    description: "NVIDIA CORP",
    conid: null,
    datetime: null,
    trade_date: "2026-06-15",
    settle_date: null,
    transaction_type: null,
    exchange: null,
    quantity: -10,
    trade_price: null,
    trade_money: null,
    proceeds: null,
    taxes: null,
    ib_commission: null,
    ib_commission_currency: null,
    net_cash: -153.2,
    open_close_indicator: null,
    cost_basis: null,
    realized_pnl: null,
    mtm_pnl: null,
    buy_sell: "SELL",
    order_id: null,
    transaction_id: null,
    ib_execution_id: null,
    ib_order_id: null,
    orig_order_id: null,
    orig_trade_price: null,
    orig_trade_date: null,
    orig_trade_id: null,
    open_datetime: null,
    level_of_detail: null,
  },
  {
    report_date: "2026-06-14",
    account_id: "DEMO",
    currency: CURRENCY,
    asset_class: "STK",
    symbol: "TSLA",
    description: "TESLA INC",
    conid: null,
    datetime: null,
    trade_date: "2026-06-14",
    settle_date: null,
    transaction_type: null,
    exchange: null,
    quantity: 5,
    trade_price: null,
    trade_money: null,
    proceeds: null,
    taxes: null,
    ib_commission: null,
    ib_commission_currency: null,
    net_cash: -542.8,
    open_close_indicator: null,
    cost_basis: null,
    realized_pnl: null,
    mtm_pnl: null,
    buy_sell: "BUY",
    order_id: null,
    transaction_id: null,
    ib_execution_id: null,
    ib_order_id: null,
    orig_order_id: null,
    orig_trade_price: null,
    orig_trade_date: null,
    orig_trade_id: null,
    open_datetime: null,
    level_of_detail: null,
  },
];

const activities: CashActivity[] = [
  {
    id: 1,
    report_date: "2026-06-16",
    activity_date: "2026-06-16",
    activity_datetime: null,
    account_id: "DEMO",
    currency: CURRENCY,
    amount: 12.34,
    activity_type: "Dividends",
    description: "Dividend received",
    source_section: null,
    symbol: "AAPL",
    fx_pair: null,
    related_trade_id: null,
    external_id: null,
  },
];

export const DASHBOARD_DEMO = {
  summary,
  navHistory,
  performanceDaily,
  realizedSummary,
  realizedDaily,
  trades,
  activities,
};
