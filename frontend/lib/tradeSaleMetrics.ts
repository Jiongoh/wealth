import type { DecimalValue, Trade } from "./api";

export type TradeSaleMetrics = {
  costPerShare: number | null;
  salePrice: number | null;
  realizedPnl: number | null;
  returnPct: number | null;
  totalCostBasis: number | null;
};

function numberOrNull(value: DecimalValue): number | null {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function tradeSaleMetrics(trade: Trade): TradeSaleMetrics | null {
  if (trade.buy_sell?.toUpperCase() !== "SELL") {
    return null;
  }

  const isOpeningSale = trade.open_close_indicator?.toUpperCase() === "O";
  const quantity = numberOrNull(trade.quantity);
  const reportedBasis = numberOrNull(trade.cost_basis);
  const totalCostBasis = !isOpeningSale && reportedBasis !== null && reportedBasis !== 0
    ? Math.abs(reportedBasis)
    : null;
  const realizedPnl = isOpeningSale ? null : numberOrNull(trade.realized_pnl);

  return {
    costPerShare: totalCostBasis !== null && quantity !== null && quantity !== 0
      ? totalCostBasis / Math.abs(quantity)
      : null,
    salePrice: numberOrNull(trade.trade_price),
    realizedPnl,
    returnPct: totalCostBasis !== null && realizedPnl !== null
      ? (realizedPnl / totalCostBasis) * 100
      : null,
    totalCostBasis,
  };
}
