import assert from "node:assert/strict";
import test from "node:test";
import { buildCashTimelineEntries, filterCashTimelineEntries } from "../lib/cashActivityTimeline.ts";

function activity(id, overrides = {}) {
  return {
    id,
    report_date: "2026-09-09",
    activity_date: "2026-09-09",
    activity_datetime: "2026-09-09T15:36:00+00:00",
    account_id: "demo-account",
    currency: "USD",
    amount: "0.33",
    activity_type: "FX_CONVERSION",
    description: null,
    source_section: "TRADES",
    symbol: "USD.CNH",
    fx_pair: "USD.CNH",
    related_trade_id: "demo-fx-1",
    external_id: "fx-base-demo-fx-1",
    ...overrides,
  };
}

const usdCredit = activity(1);
const stockSell = activity(2, {
  activity_type: "STOCK_SELL",
  amount: "407.62",
  symbol: "LITE",
  fx_pair: null,
  related_trade_id: "demo-stock-1",
});
const cnhDebit = activity(3, {
  currency: "CNH",
  amount: "-2.21",
  external_id: "demo-fx-1",
});

test("pairs one FX execution across an intervening stock sale", () => {
  const entries = buildCashTimelineEntries([usdCredit, stockSell, cnhDebit]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].activity.id, 1);
  assert.equal(entries[0].fxCounterpart?.id, 3);
  assert.equal(entries[1].activity.id, 2);
});

test("either currency filter preserves both FX legs", () => {
  const entries = buildCashTimelineEntries([usdCredit, stockSell, cnhDebit]);
  const filters = { currency: "CNH", activityType: "", startDate: "", endDate: "" };
  const cnhEntries = filterCashTimelineEntries(entries, filters);
  assert.equal(cnhEntries.length, 1);
  assert.equal(cnhEntries[0].fxCounterpart?.currency, "CNH");
  assert.equal(filterCashTimelineEntries(entries, { ...filters, currency: "USD" }).length, 2);
});

test("does not merge unrelated or incomplete conversions", () => {
  const unrelated = activity(4, { currency: "CNH", amount: "-2.21", related_trade_id: "demo-fx-2" });
  const sameCurrency = activity(5, { amount: "-0.33" });
  const unlinked = activity(6, { currency: "CNH", amount: "-2.21", related_trade_id: null });
  const entries = buildCashTimelineEntries([usdCredit, unrelated, sameCurrency, unlinked]);
  assert.equal(entries.length, 4);
  assert.ok(entries.every((entry) => entry.fxCounterpart === null));
});

test("reverse conversion still pairs debit and credit", () => {
  const usdDebit = activity(7, { amount: "-10", related_trade_id: "demo-fx-reverse" });
  const cnhCredit = activity(8, { currency: "CNH", amount: "68", related_trade_id: "demo-fx-reverse" });
  const entries = buildCashTimelineEntries([usdDebit, cnhCredit]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].fxCounterpart?.amount, "68");
});

test("pairs a stock sale and its commission around an FX conversion", () => {
  const commission = activity(9, {
    activity_type: "COMMISSION",
    amount: "-0.36",
    symbol: "LITE",
    fx_pair: null,
    related_trade_id: "demo-stock-1",
  });
  const entries = buildCashTimelineEntries([stockSell, usdCredit, commission, cnhDebit]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].activity.id, 2);
  assert.equal(entries[0].commission?.id, 9);
  assert.equal(entries[1].fxCounterpart?.id, 3);
  assert.equal(Number(entries[0].activity.amount) + Number(entries[0].commission.amount), 407.26);
  const commissionFilter = { currency: "", activityType: "COMMISSION", startDate: "", endDate: "" };
  assert.equal(filterCashTimelineEntries(entries, commissionFilter)[0].activity.activity_type, "STOCK_SELL");
});

test("a commission arriving first still produces a stock trade card", () => {
  const stockBuy = activity(10, {
    activity_type: "STOCK_BUY",
    amount: "-25",
    symbol: "ALFA",
    fx_pair: null,
    related_trade_id: "demo-stock-2",
  });
  const commission = activity(11, {
    activity_type: "COMMISSION",
    amount: "-0.35",
    symbol: "ALFA",
    fx_pair: null,
    related_trade_id: "demo-stock-2",
  });
  const entries = buildCashTimelineEntries([commission, stockBuy]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].activity.activity_type, "STOCK_BUY");
  assert.equal(entries[0].commission?.id, 11);
});

test("does not attach commission from a different trade", () => {
  const commission = activity(12, {
    activity_type: "COMMISSION",
    amount: "-0.36",
    symbol: "LITE",
    fx_pair: null,
    related_trade_id: "demo-stock-other",
  });
  const entries = buildCashTimelineEntries([stockSell, commission]);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.commission === null));
});
