"""Create cash activities table.

Revision ID: 20260602_0005
Revises: 20260601_0004
Create Date: 2026-06-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260602_0005"
down_revision: str | Sequence[str] | None = "20260601_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

decimal = sa.Numeric(28, 10)


def upgrade() -> None:
    op.create_table(
        "cash_activities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("activity_date", sa.Date(), nullable=True),
        sa.Column("activity_datetime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("account_id", sa.String(length=128), nullable=True),
        sa.Column("currency", sa.String(length=16), nullable=True),
        sa.Column("amount", decimal, nullable=True),
        sa.Column("activity_type", sa.String(length=32), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source_section", sa.String(length=64), nullable=True),
        sa.Column("symbol", sa.String(length=255), nullable=True),
        sa.Column("fx_pair", sa.String(length=16), nullable=True),
        sa.Column("related_trade_id", sa.String(length=255), nullable=True),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("raw_flex_report_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["raw_flex_report_id"], ["raw_flex_reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
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
    op.create_index("ix_cash_activities_account_id", "cash_activities", ["account_id"])
    op.create_index("ix_cash_activities_activity_date", "cash_activities", ["activity_date"])
    op.create_index("ix_cash_activities_activity_type", "cash_activities", ["activity_type"])
    op.create_index("ix_cash_activities_currency", "cash_activities", ["currency"])
    op.create_index("ix_cash_activities_fx_pair", "cash_activities", ["fx_pair"])
    op.create_index("ix_cash_activities_raw_flex_report_id", "cash_activities", ["raw_flex_report_id"])
    op.create_index("ix_cash_activities_report_date", "cash_activities", ["report_date"])
    op.create_index("ix_cash_activities_source_section", "cash_activities", ["source_section"])
    op.create_index("ix_cash_activities_symbol", "cash_activities", ["symbol"])
    op.execute(
        """
        INSERT INTO cash_activities (
            report_date,
            activity_date,
            activity_datetime,
            account_id,
            currency,
            amount,
            activity_type,
            description,
            source_section,
            symbol,
            fx_pair,
            related_trade_id,
            external_id,
            raw_flex_report_id
        )
        SELECT
            report_date,
            COALESCE(trade_date, datetime::date, report_date),
            datetime,
            account_id,
            UPPER(currency),
            COALESCE(net_cash, proceeds, trade_money),
            'FX_CONVERSION',
            COALESCE(symbol || ' auto FX conversion', 'Auto FX conversion'),
            'TRADES',
            symbol,
            CASE WHEN symbol LIKE '%.%' THEN UPPER(symbol) ELSE NULL END,
            COALESCE(transaction_id, ib_execution_id),
            COALESCE(transaction_id, ib_execution_id, order_id, id::text),
            raw_flex_report_id
        FROM trades
        WHERE COALESCE(net_cash, proceeds, trade_money) IS NOT NULL
          AND COALESCE(net_cash, proceeds, trade_money) <> 0
          AND (
            UPPER(COALESCE(asset_class, '')) IN ('CASH', 'FX', 'FOREX', 'CURRENCY', 'CURR')
            OR UPPER(COALESCE(asset_class, '')) LIKE '%FOREX%'
            OR UPPER(COALESCE(asset_class, '')) LIKE '%CURRENCY%'
            OR UPPER(COALESCE(symbol, '')) ~ '^[A-Z]{3}\\.[A-Z]{3}$'
          )
        ON CONFLICT ON CONSTRAINT uq_cash_activities_source_identity DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("cash_activities")
