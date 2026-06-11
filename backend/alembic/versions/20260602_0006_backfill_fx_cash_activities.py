"""Backfill FX conversion cash activities with non-zero trade amounts.

Revision ID: 20260602_0006
Revises: 20260602_0005
Create Date: 2026-06-02
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260602_0006"
down_revision: str | Sequence[str] | None = "20260602_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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
            COALESCE(NULLIF(net_cash, 0), NULLIF(proceeds, 0), NULLIF(trade_money, 0)),
            'FX_CONVERSION',
            COALESCE(symbol || ' auto FX conversion', 'Auto FX conversion'),
            'TRADES',
            symbol,
            CASE WHEN symbol LIKE '%.%' THEN UPPER(symbol) ELSE NULL END,
            COALESCE(transaction_id, ib_execution_id),
            COALESCE(transaction_id, ib_execution_id, order_id, id::text),
            raw_flex_report_id
        FROM trades
        WHERE COALESCE(NULLIF(net_cash, 0), NULLIF(proceeds, 0), NULLIF(trade_money, 0)) IS NOT NULL
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
    op.execute(
        """
        DELETE FROM cash_activities
        WHERE source_section = 'TRADES'
          AND activity_type = 'FX_CONVERSION'
          AND symbol ~ '^[A-Z]{3}\\.[A-Z]{3}$'
        """
    )
