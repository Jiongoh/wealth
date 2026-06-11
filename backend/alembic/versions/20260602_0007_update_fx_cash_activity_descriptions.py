"""Make FX cash activity descriptions show cash flow direction.

Revision ID: 20260602_0007
Revises: 20260602_0006
Create Date: 2026-06-02
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260602_0007"
down_revision: str | Sequence[str] | None = "20260602_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE cash_activities AS ca
        SET description = CASE
            WHEN UPPER(COALESCE(t.buy_sell, '')) = 'SELL' THEN
                split_part(UPPER(t.symbol), '.', 1)
                || ' $' || to_char(ABS(t.quantity), 'FM999999999990.00')
                || ' → '
                || UPPER(COALESCE(t.currency, split_part(t.symbol, '.', 2)))
                || ' $' || to_char(ABS(COALESCE(NULLIF(t.proceeds, 0), NULLIF(t.trade_money, 0), ca.amount)), 'FM999999999990.00')
                || ' auto FX conversion'
            ELSE
                UPPER(COALESCE(t.currency, split_part(t.symbol, '.', 2)))
                || ' $' || to_char(ABS(COALESCE(NULLIF(t.proceeds, 0), NULLIF(t.trade_money, 0), ca.amount)), 'FM999999999990.00')
                || ' → '
                || split_part(UPPER(t.symbol), '.', 1)
                || ' $' || to_char(ABS(t.quantity), 'FM999999999990.00')
                || ' auto FX conversion'
            END
        FROM trades AS t
        WHERE ca.source_section = 'TRADES'
          AND ca.activity_type = 'FX_CONVERSION'
          AND ca.raw_flex_report_id = t.raw_flex_report_id
          AND ca.external_id = COALESCE(t.transaction_id, t.ib_execution_id, t.order_id, t.id::text)
          AND UPPER(COALESCE(t.symbol, '')) ~ '^[A-Z]{3}\\.[A-Z]{3}$'
          AND t.quantity IS NOT NULL
          AND t.quantity <> 0
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE cash_activities
        SET description = COALESCE(symbol || ' auto FX conversion', 'Auto FX conversion')
        WHERE source_section = 'TRADES'
          AND activity_type = 'FX_CONVERSION'
          AND symbol ~ '^[A-Z]{3}\\.[A-Z]{3}$'
        """
    )
