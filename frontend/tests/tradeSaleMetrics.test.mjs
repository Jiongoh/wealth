import assert from "node:assert/strict";
import test from "node:test";
import { tradeSaleMetrics } from "../lib/tradeSaleMetrics.ts";

function sale(overrides = {}) {
  return {
    buy_sell: "SELL",
    open_close_indicator: "C",
    quantity: "-0.406",
    trade_price: "1004.00",
    cost_basis: "-372.084913",
    realized_pnl: "35.180272",
    ...overrides,
  };
}

test("uses the sold shares' reported basis and realized P&L", () => {
  const metrics = tradeSaleMetrics(sale());
  assert.ok(metrics);
  assert.equal(metrics.salePrice, 1004);
  assert.equal(metrics.totalCostBasis, 372.084913);
  assert.ok(Math.abs(metrics.costPerShare - 372.084913 / 0.406) < 1e-9);
  assert.equal(metrics.realizedPnl, 35.180272);
  assert.ok(Math.abs(metrics.returnPct - 35.180272 / 372.084913 * 100) < 1e-9);
});

test("shows a negative return for a losing sale", () => {
  const metrics = tradeSaleMetrics(sale({ realized_pnl: "-12.50" }));
  assert.equal(metrics.realizedPnl, -12.5);
  assert.ok(metrics.returnPct < 0);
});

test("does not invent basis or return for incomplete or opening sales", () => {
  const missingBasis = tradeSaleMetrics(sale({ cost_basis: null }));
  assert.equal(missingBasis.costPerShare, null);
  assert.equal(missingBasis.returnPct, null);
  const opening = tradeSaleMetrics(sale({ open_close_indicator: "O" }));
  assert.equal(opening.totalCostBasis, null);
  assert.equal(opening.realizedPnl, null);
  assert.equal(opening.returnPct, null);
});

test("leaves buys unchanged", () => {
  assert.equal(tradeSaleMetrics(sale({ buy_sell: "BUY" })), null);
});
