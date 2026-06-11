from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

DECIMAL_TYPE = Numeric(28, 10)
ACCOUNT_ID_TYPE = String(128)
SYMBOL_TYPE = String(255)
CONID_TYPE = String(64)
CURRENCY_TYPE = String(16)
ASSET_CLASS_TYPE = String(32)
IDENTIFIER_TYPE = String(255)


class PositionLot(Base):
    __tablename__ = "positions_lot"
    __table_args__ = (
        UniqueConstraint(
            "raw_flex_report_id",
            "account_id",
            "conid",
            "open_datetime",
            "originating_order_id",
            "originating_transaction_id",
            "quantity",
            "cost_basis_money",
            "side",
            "level_of_detail",
            name="uq_positions_lot_source_identity",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    account_id: Mapped[str | None] = mapped_column(ACCOUNT_ID_TYPE, nullable=True, index=True)
    currency: Mapped[str | None] = mapped_column(CURRENCY_TYPE, nullable=True)
    asset_class: Mapped[str | None] = mapped_column(ASSET_CLASS_TYPE, nullable=True)
    symbol: Mapped[str | None] = mapped_column(SYMBOL_TYPE, nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    conid: Mapped[str | None] = mapped_column(CONID_TYPE, nullable=True, index=True)
    quantity: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    mark_price: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    position_value: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    open_price: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    cost_basis_price: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    cost_basis_money: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    unrealized_pnl: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    side: Mapped[str | None] = mapped_column(String(16), nullable=True)
    level_of_detail: Mapped[str | None] = mapped_column(String(64), nullable=True)
    open_datetime: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    holding_period_datetime: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    originating_order_id: Mapped[str | None] = mapped_column(IDENTIFIER_TYPE, nullable=True)
    originating_transaction_id: Mapped[str | None] = mapped_column(
        IDENTIFIER_TYPE, nullable=True
    )
    raw_flex_report_id: Mapped[int] = mapped_column(
        ForeignKey("raw_flex_reports.id", ondelete="CASCADE"), nullable=False, index=True
    )


class Trade(Base):
    __tablename__ = "trades"
    __table_args__ = (
        UniqueConstraint(
            "raw_flex_report_id",
            "account_id",
            "transaction_id",
            "ib_execution_id",
            "order_id",
            "datetime",
            "conid",
            "quantity",
            "trade_price",
            name="uq_trades_source_identity",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    account_id: Mapped[str | None] = mapped_column(ACCOUNT_ID_TYPE, nullable=True, index=True)
    currency: Mapped[str | None] = mapped_column(CURRENCY_TYPE, nullable=True)
    asset_class: Mapped[str | None] = mapped_column(ASSET_CLASS_TYPE, nullable=True)
    symbol: Mapped[str | None] = mapped_column(SYMBOL_TYPE, nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    conid: Mapped[str | None] = mapped_column(CONID_TYPE, nullable=True, index=True)
    datetime: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    trade_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    settle_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    transaction_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    exchange: Mapped[str | None] = mapped_column(String(128), nullable=True)
    quantity: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    trade_price: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    trade_money: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    proceeds: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    taxes: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    ib_commission: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    ib_commission_currency: Mapped[str | None] = mapped_column(CURRENCY_TYPE, nullable=True)
    net_cash: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    open_close_indicator: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cost_basis: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    realized_pnl: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    mtm_pnl: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    buy_sell: Mapped[str | None] = mapped_column(String(16), nullable=True)
    order_id: Mapped[str | None] = mapped_column(IDENTIFIER_TYPE, nullable=True)
    transaction_id: Mapped[str | None] = mapped_column(IDENTIFIER_TYPE, nullable=True)
    ib_execution_id: Mapped[str | None] = mapped_column(IDENTIFIER_TYPE, nullable=True)
    ib_order_id: Mapped[str | None] = mapped_column(IDENTIFIER_TYPE, nullable=True)
    orig_order_id: Mapped[str | None] = mapped_column(IDENTIFIER_TYPE, nullable=True)
    orig_trade_price: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    orig_trade_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    orig_trade_id: Mapped[str | None] = mapped_column(IDENTIFIER_TYPE, nullable=True)
    open_datetime: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    level_of_detail: Mapped[str | None] = mapped_column(String(64), nullable=True)
    raw_flex_report_id: Mapped[int] = mapped_column(
        ForeignKey("raw_flex_reports.id", ondelete="CASCADE"), nullable=False, index=True
    )


class CashReport(Base):
    __tablename__ = "cash_report"
    __table_args__ = (
        UniqueConstraint(
            "raw_flex_report_id",
            "report_date",
            "account_id",
            "currency",
            "level_of_detail",
            "from_date",
            "to_date",
            name="uq_cash_report_source_identity",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    account_id: Mapped[str | None] = mapped_column(ACCOUNT_ID_TYPE, nullable=True, index=True)
    currency: Mapped[str | None] = mapped_column(CURRENCY_TYPE, nullable=True, index=True)
    level_of_detail: Mapped[str | None] = mapped_column(String(64), nullable=True)
    from_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    to_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    starting_cash: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    deposits: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    withdrawals: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    deposit_withdrawals: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    dividends: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    broker_interest_paid_received: Mapped[Decimal | None] = mapped_column(
        DECIMAL_TYPE, nullable=True
    )
    commissions: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    net_trades_sales: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    net_trades_purchases: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    withholding_tax: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    transaction_tax: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    fx_translation_gain_loss: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    other_fees: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    other_income: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    other: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    ending_cash: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    ending_settled_cash: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    raw_flex_report_id: Mapped[int] = mapped_column(
        ForeignKey("raw_flex_reports.id", ondelete="CASCADE"), nullable=False, index=True
    )


class CashActivity(Base):
    __tablename__ = "cash_activities"
    __table_args__ = (
        UniqueConstraint(
            "raw_flex_report_id",
            "source_section",
            "external_id",
            "activity_type",
            "currency",
            "amount",
            name="uq_cash_activities_source_identity",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    activity_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    activity_datetime: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    account_id: Mapped[str | None] = mapped_column(ACCOUNT_ID_TYPE, nullable=True, index=True)
    currency: Mapped[str | None] = mapped_column(CURRENCY_TYPE, nullable=True, index=True)
    amount: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    activity_type: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_section: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    symbol: Mapped[str | None] = mapped_column(SYMBOL_TYPE, nullable=True, index=True)
    fx_pair: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    related_trade_id: Mapped[str | None] = mapped_column(IDENTIFIER_TYPE, nullable=True)
    external_id: Mapped[str | None] = mapped_column(IDENTIFIER_TYPE, nullable=True)
    raw_flex_report_id: Mapped[int] = mapped_column(
        ForeignKey("raw_flex_reports.id", ondelete="CASCADE"), nullable=False, index=True
    )


class NavDaily(Base):
    __tablename__ = "nav_daily"
    __table_args__ = (
        UniqueConstraint(
            "raw_flex_report_id",
            "report_date",
            "account_id",
            "currency",
            name="uq_nav_daily_source_identity",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    account_id: Mapped[str | None] = mapped_column(ACCOUNT_ID_TYPE, nullable=True, index=True)
    currency: Mapped[str | None] = mapped_column(CURRENCY_TYPE, nullable=True, index=True)
    cash: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    stock: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    options: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    funds: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    dividend_accruals: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    interest_accruals: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    broker_interest_accruals_component: Mapped[Decimal | None] = mapped_column(
        DECIMAL_TYPE, nullable=True
    )
    margin_financing_charge_accruals: Mapped[Decimal | None] = mapped_column(
        DECIMAL_TYPE, nullable=True
    )
    crypto: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    total: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    raw_flex_report_id: Mapped[int] = mapped_column(
        ForeignKey("raw_flex_reports.id", ondelete="CASCADE"), nullable=False, index=True
    )


class LotAnalysisDaily(Base):
    __tablename__ = "lot_analysis_daily"
    __table_args__ = (
        UniqueConstraint(
            "raw_flex_report_id",
            "report_date",
            "account_id",
            "symbol",
            "conid",
            name="uq_lot_analysis_daily_source_identity",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    account_id: Mapped[str | None] = mapped_column(ACCOUNT_ID_TYPE, nullable=True, index=True)
    symbol: Mapped[str | None] = mapped_column(SYMBOL_TYPE, nullable=True, index=True)
    conid: Mapped[str | None] = mapped_column(CONID_TYPE, nullable=True, index=True)
    total_quantity: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    current_price: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    total_cost_basis_money: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    avg_cost: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    unrealized_pnl: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    highest_cost_lot_quantity: Mapped[Decimal | None] = mapped_column(
        DECIMAL_TYPE, nullable=True
    )
    highest_cost_lot_price: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    highest_cost_lot_cost_basis_money: Mapped[Decimal | None] = mapped_column(
        DECIMAL_TYPE, nullable=True
    )
    highest_cost_lot_open_datetime: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    highest_cost_lot_profit_pct: Mapped[Decimal | None] = mapped_column(
        DECIMAL_TYPE, nullable=True
    )
    highest_cost_lot_profit_over_20: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    avg_cost_without_highest_lot: Mapped[Decimal | None] = mapped_column(
        DECIMAL_TYPE, nullable=True
    )
    remaining_quantity_without_highest_lot: Mapped[Decimal | None] = mapped_column(
        DECIMAL_TYPE, nullable=True
    )
    remaining_cost_without_highest_lot: Mapped[Decimal | None] = mapped_column(
        DECIMAL_TYPE, nullable=True
    )
    raw_flex_report_id: Mapped[int] = mapped_column(
        ForeignKey("raw_flex_reports.id", ondelete="CASCADE"), nullable=False, index=True
    )
