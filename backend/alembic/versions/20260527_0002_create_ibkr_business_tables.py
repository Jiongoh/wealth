"""Create IBKR business data tables.

Revision ID: 20260527_0002
Revises: 20260526_0001
Create Date: 2026-05-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260527_0002"
down_revision: str | Sequence[str] | None = "20260526_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    decimal = sa.Numeric(precision=28, scale=10)

    op.create_table(
        "positions_lot",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("account_id", sa.String(length=128), nullable=True),
        sa.Column("currency", sa.String(length=16), nullable=True),
        sa.Column("asset_class", sa.String(length=32), nullable=True),
        sa.Column("symbol", sa.String(length=255), nullable=True),
        sa.Column("description", sa.String(length=1024), nullable=True),
        sa.Column("conid", sa.String(length=64), nullable=True),
        sa.Column("quantity", decimal, nullable=True),
        sa.Column("mark_price", decimal, nullable=True),
        sa.Column("position_value", decimal, nullable=True),
        sa.Column("open_price", decimal, nullable=True),
        sa.Column("cost_basis_price", decimal, nullable=True),
        sa.Column("cost_basis_money", decimal, nullable=True),
        sa.Column("unrealized_pnl", decimal, nullable=True),
        sa.Column("side", sa.String(length=16), nullable=True),
        sa.Column("level_of_detail", sa.String(length=64), nullable=True),
        sa.Column("open_datetime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("holding_period_datetime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("originating_order_id", sa.String(length=255), nullable=True),
        sa.Column("originating_transaction_id", sa.String(length=255), nullable=True),
        sa.Column("raw_flex_report_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["raw_flex_report_id"], ["raw_flex_reports.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
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
    op.create_index("ix_positions_lot_account_id", "positions_lot", ["account_id"])
    op.create_index("ix_positions_lot_conid", "positions_lot", ["conid"])
    op.create_index("ix_positions_lot_raw_flex_report_id", "positions_lot", ["raw_flex_report_id"])
    op.create_index("ix_positions_lot_report_date", "positions_lot", ["report_date"])
    op.create_index("ix_positions_lot_symbol", "positions_lot", ["symbol"])

    op.create_table(
        "trades",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("account_id", sa.String(length=128), nullable=True),
        sa.Column("currency", sa.String(length=16), nullable=True),
        sa.Column("asset_class", sa.String(length=32), nullable=True),
        sa.Column("symbol", sa.String(length=255), nullable=True),
        sa.Column("description", sa.String(length=1024), nullable=True),
        sa.Column("conid", sa.String(length=64), nullable=True),
        sa.Column("datetime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trade_date", sa.Date(), nullable=True),
        sa.Column("settle_date", sa.Date(), nullable=True),
        sa.Column("transaction_type", sa.String(length=64), nullable=True),
        sa.Column("exchange", sa.String(length=128), nullable=True),
        sa.Column("quantity", decimal, nullable=True),
        sa.Column("trade_price", decimal, nullable=True),
        sa.Column("trade_money", decimal, nullable=True),
        sa.Column("proceeds", decimal, nullable=True),
        sa.Column("taxes", decimal, nullable=True),
        sa.Column("ib_commission", decimal, nullable=True),
        sa.Column("ib_commission_currency", sa.String(length=16), nullable=True),
        sa.Column("net_cash", decimal, nullable=True),
        sa.Column("open_close_indicator", sa.String(length=32), nullable=True),
        sa.Column("cost_basis", decimal, nullable=True),
        sa.Column("realized_pnl", decimal, nullable=True),
        sa.Column("mtm_pnl", decimal, nullable=True),
        sa.Column("buy_sell", sa.String(length=16), nullable=True),
        sa.Column("order_id", sa.String(length=255), nullable=True),
        sa.Column("transaction_id", sa.String(length=255), nullable=True),
        sa.Column("ib_execution_id", sa.String(length=255), nullable=True),
        sa.Column("ib_order_id", sa.String(length=255), nullable=True),
        sa.Column("orig_order_id", sa.String(length=255), nullable=True),
        sa.Column("orig_trade_price", decimal, nullable=True),
        sa.Column("orig_trade_date", sa.Date(), nullable=True),
        sa.Column("orig_trade_id", sa.String(length=255), nullable=True),
        sa.Column("open_datetime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("level_of_detail", sa.String(length=64), nullable=True),
        sa.Column("raw_flex_report_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["raw_flex_report_id"], ["raw_flex_reports.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
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
    op.create_index("ix_trades_account_id", "trades", ["account_id"])
    op.create_index("ix_trades_conid", "trades", ["conid"])
    op.create_index("ix_trades_raw_flex_report_id", "trades", ["raw_flex_report_id"])
    op.create_index("ix_trades_report_date", "trades", ["report_date"])
    op.create_index("ix_trades_symbol", "trades", ["symbol"])
    op.create_index("ix_trades_trade_date", "trades", ["trade_date"])

    op.create_table(
        "cash_report",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("account_id", sa.String(length=128), nullable=True),
        sa.Column("currency", sa.String(length=16), nullable=True),
        sa.Column("level_of_detail", sa.String(length=64), nullable=True),
        sa.Column("from_date", sa.Date(), nullable=True),
        sa.Column("to_date", sa.Date(), nullable=True),
        sa.Column("starting_cash", decimal, nullable=True),
        sa.Column("deposits", decimal, nullable=True),
        sa.Column("withdrawals", decimal, nullable=True),
        sa.Column("deposit_withdrawals", decimal, nullable=True),
        sa.Column("dividends", decimal, nullable=True),
        sa.Column("broker_interest_paid_received", decimal, nullable=True),
        sa.Column("commissions", decimal, nullable=True),
        sa.Column("net_trades_sales", decimal, nullable=True),
        sa.Column("net_trades_purchases", decimal, nullable=True),
        sa.Column("withholding_tax", decimal, nullable=True),
        sa.Column("transaction_tax", decimal, nullable=True),
        sa.Column("fx_translation_gain_loss", decimal, nullable=True),
        sa.Column("other_fees", decimal, nullable=True),
        sa.Column("other_income", decimal, nullable=True),
        sa.Column("other", decimal, nullable=True),
        sa.Column("ending_cash", decimal, nullable=True),
        sa.Column("ending_settled_cash", decimal, nullable=True),
        sa.Column("raw_flex_report_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["raw_flex_report_id"], ["raw_flex_reports.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
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
    op.create_index("ix_cash_report_account_id", "cash_report", ["account_id"])
    op.create_index("ix_cash_report_currency", "cash_report", ["currency"])
    op.create_index("ix_cash_report_raw_flex_report_id", "cash_report", ["raw_flex_report_id"])
    op.create_index("ix_cash_report_report_date", "cash_report", ["report_date"])

    op.create_table(
        "nav_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("account_id", sa.String(length=128), nullable=True),
        sa.Column("currency", sa.String(length=16), nullable=True),
        sa.Column("cash", decimal, nullable=True),
        sa.Column("stock", decimal, nullable=True),
        sa.Column("options", decimal, nullable=True),
        sa.Column("funds", decimal, nullable=True),
        sa.Column("dividend_accruals", decimal, nullable=True),
        sa.Column("interest_accruals", decimal, nullable=True),
        sa.Column("broker_interest_accruals_component", decimal, nullable=True),
        sa.Column("margin_financing_charge_accruals", decimal, nullable=True),
        sa.Column("crypto", decimal, nullable=True),
        sa.Column("total", decimal, nullable=True),
        sa.Column("raw_flex_report_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["raw_flex_report_id"], ["raw_flex_reports.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "raw_flex_report_id",
            "report_date",
            "account_id",
            "currency",
            name="uq_nav_daily_source_identity",
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_index("ix_nav_daily_account_id", "nav_daily", ["account_id"])
    op.create_index("ix_nav_daily_currency", "nav_daily", ["currency"])
    op.create_index("ix_nav_daily_raw_flex_report_id", "nav_daily", ["raw_flex_report_id"])
    op.create_index("ix_nav_daily_report_date", "nav_daily", ["report_date"])

    op.create_table(
        "lot_analysis_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("account_id", sa.String(length=128), nullable=True),
        sa.Column("symbol", sa.String(length=255), nullable=True),
        sa.Column("conid", sa.String(length=64), nullable=True),
        sa.Column("total_quantity", decimal, nullable=True),
        sa.Column("current_price", decimal, nullable=True),
        sa.Column("total_cost_basis_money", decimal, nullable=True),
        sa.Column("avg_cost", decimal, nullable=True),
        sa.Column("unrealized_pnl", decimal, nullable=True),
        sa.Column("highest_cost_lot_quantity", decimal, nullable=True),
        sa.Column("highest_cost_lot_price", decimal, nullable=True),
        sa.Column("highest_cost_lot_cost_basis_money", decimal, nullable=True),
        sa.Column("highest_cost_lot_open_datetime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("highest_cost_lot_profit_pct", decimal, nullable=True),
        sa.Column("highest_cost_lot_profit_over_20", sa.Boolean(), nullable=True),
        sa.Column("avg_cost_without_highest_lot", decimal, nullable=True),
        sa.Column("remaining_quantity_without_highest_lot", decimal, nullable=True),
        sa.Column("remaining_cost_without_highest_lot", decimal, nullable=True),
        sa.Column("raw_flex_report_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["raw_flex_report_id"], ["raw_flex_reports.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "raw_flex_report_id",
            "report_date",
            "account_id",
            "symbol",
            "conid",
            name="uq_lot_analysis_daily_source_identity",
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_index("ix_lot_analysis_daily_account_id", "lot_analysis_daily", ["account_id"])
    op.create_index("ix_lot_analysis_daily_conid", "lot_analysis_daily", ["conid"])
    op.create_index(
        "ix_lot_analysis_daily_raw_flex_report_id",
        "lot_analysis_daily",
        ["raw_flex_report_id"],
    )
    op.create_index("ix_lot_analysis_daily_report_date", "lot_analysis_daily", ["report_date"])
    op.create_index("ix_lot_analysis_daily_symbol", "lot_analysis_daily", ["symbol"])


def downgrade() -> None:
    op.drop_table("lot_analysis_daily")
    op.drop_table("nav_daily")
    op.drop_table("cash_report")
    op.drop_table("trades")
    op.drop_table("positions_lot")
