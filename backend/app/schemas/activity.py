from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class TradeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    report_date: date | None
    account_id: str | None
    currency: str | None
    asset_class: str | None
    symbol: str | None
    description: str | None
    conid: str | None
    datetime: datetime | None
    trade_date: date | None
    settle_date: date | None
    transaction_type: str | None
    exchange: str | None
    quantity: Decimal | None
    trade_price: Decimal | None
    trade_money: Decimal | None
    proceeds: Decimal | None
    taxes: Decimal | None
    ib_commission: Decimal | None
    ib_commission_currency: str | None
    net_cash: Decimal | None
    open_close_indicator: str | None
    cost_basis: Decimal | None
    realized_pnl: Decimal | None
    mtm_pnl: Decimal | None
    buy_sell: str | None
    order_id: str | None
    transaction_id: str | None
    ib_execution_id: str | None
    ib_order_id: str | None
    orig_order_id: str | None
    orig_trade_price: Decimal | None
    orig_trade_date: date | None
    orig_trade_id: str | None
    open_datetime: datetime | None
    level_of_detail: str | None


class TradeListResponse(BaseModel):
    items: list[TradeResponse]
    total_count: int
    buy_count: int
    sell_count: int
    symbol_filter: str


class CashReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    report_date: date | None
    account_id: str | None
    currency: str | None
    level_of_detail: str | None
    from_date: date | None
    to_date: date | None
    starting_cash: Decimal | None
    deposits: Decimal | None
    withdrawals: Decimal | None
    deposit_withdrawals: Decimal | None
    dividends: Decimal | None
    broker_interest_paid_received: Decimal | None
    commissions: Decimal | None
    net_trades_sales: Decimal | None
    net_trades_purchases: Decimal | None
    withholding_tax: Decimal | None
    transaction_tax: Decimal | None
    fx_translation_gain_loss: Decimal | None
    other_fees: Decimal | None
    other_income: Decimal | None
    other: Decimal | None
    ending_cash: Decimal | None
    ending_settled_cash: Decimal | None


class CashBalancePointResponse(BaseModel):
    date: date
    currency: str
    balance: Decimal


class CashBalanceTimeseriesResponse(BaseModel):
    items: list[CashBalancePointResponse]
    currencies: list[str]


class CashActivityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    report_date: date | None
    activity_date: date | None
    activity_datetime: datetime | None
    account_id: str | None
    currency: str | None
    amount: Decimal | None
    activity_type: str | None
    description: str | None
    source_section: str | None
    symbol: str | None
    fx_pair: str | None
    related_trade_id: str | None
    external_id: str | None


class CashActivityListResponse(BaseModel):
    items: list[CashActivityResponse]
    total_count: int
    by_type: dict[str, int]
