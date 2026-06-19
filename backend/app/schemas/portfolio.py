from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class PortfolioSummaryResponse(BaseModel):
    report_date: date
    total_nav: Decimal | None
    cash: Decimal | None
    stock: Decimal | None
    unrealized_pnl: Decimal | None
    currency: str | None


class NavDailyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    report_date: date | None
    account_id: str | None
    currency: str | None
    cash: Decimal | None
    stock: Decimal | None
    options: Decimal | None
    funds: Decimal | None
    dividend_accruals: Decimal | None
    interest_accruals: Decimal | None
    broker_interest_accruals_component: Decimal | None
    margin_financing_charge_accruals: Decimal | None
    crypto: Decimal | None
    total: Decimal | None


class ExternalCashFlow(BaseModel):
    currency: str | None
    amount: Decimal


class PortfolioPerformanceDailyResponse(BaseModel):
    date: date
    currency: str | None
    nav: Decimal | None
    previous_date: date | None
    previous_nav: Decimal | None
    # Base-currency external cash flow used in the performance calculation. Only
    # flows already denominated in the NAV base currency are included here;
    # foreign-currency flows are reported separately in `external_cash_flows`
    # (we do not FX-convert them).
    external_cash_flow: Decimal
    external_cash_flows: list[ExternalCashFlow]
    performance_amount: Decimal | None
    performance_pct: Decimal | None


class CurrentPositionResponse(BaseModel):
    symbol: str | None
    conid: str | None
    total_quantity: Decimal | None
    current_price: Decimal | None
    avg_cost: Decimal | None
    market_value: Decimal | None
    unrealized_pnl: Decimal | None
    unrealized_pnl_pct: Decimal | None
    weight_pct: Decimal | None


class PositionLotResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    report_date: date | None
    account_id: str | None
    currency: str | None
    asset_class: str | None
    symbol: str | None
    description: str | None
    conid: str | None
    quantity: Decimal | None
    mark_price: Decimal | None
    position_value: Decimal | None
    open_price: Decimal | None
    cost_basis_price: Decimal | None
    cost_basis_money: Decimal | None
    unrealized_pnl: Decimal | None
    side: str | None
    level_of_detail: str | None
    open_datetime: datetime | None
    holding_period_datetime: datetime | None
    originating_order_id: str | None
    originating_transaction_id: str | None


class LotAnalysisResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    report_date: date | None
    account_id: str | None
    symbol: str | None
    conid: str | None
    total_quantity: Decimal | None
    current_price: Decimal | None
    total_cost_basis_money: Decimal | None
    avg_cost: Decimal | None
    unrealized_pnl: Decimal | None
    highest_cost_lot_quantity: Decimal | None
    highest_cost_lot_price: Decimal | None
    highest_cost_lot_cost_basis_money: Decimal | None
    highest_cost_lot_open_datetime: datetime | None
    highest_cost_lot_profit_pct: Decimal | None
    highest_cost_lot_profit_over_20: bool | None
    avg_cost_without_highest_lot: Decimal | None
    remaining_quantity_without_highest_lot: Decimal | None
    remaining_cost_without_highest_lot: Decimal | None
