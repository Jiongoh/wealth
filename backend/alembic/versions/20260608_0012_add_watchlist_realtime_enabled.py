"""Add realtime tracking flag to watchlist tickers.

Revision ID: 20260608_0012
Revises: 20260608_0011
Create Date: 2026-06-08
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260608_0012"
down_revision: str | Sequence[str] | None = "20260608_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "watchlist_tickers",
        sa.Column("realtime_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("watchlist_tickers", "realtime_enabled")
