"""Add market quote source timestamp lookup index.

Revision ID: 20260610_0013
Revises: 20260608_0012
Create Date: 2026-06-10
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260610_0013"
down_revision: str | Sequence[str] | None = "20260608_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_market_quotes_symbol_provider_feed_source_timestamp
        ON market_quotes (symbol, provider, feed, source_timestamp)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_market_quotes_symbol_provider_feed_source_timestamp")
