"""Drop retired watchlist tables.

Revision ID: 20260814_0014
Revises: 20260610_0013
Create Date: 2026-08-14
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260814_0014"
down_revision: str | Sequence[str] | None = "20260610_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("watchlist_ticker_tags")
    op.drop_index("ix_watchlist_tags_name", table_name="watchlist_tags")
    op.drop_table("watchlist_tags")
    op.drop_index("ix_watchlist_tickers_symbol", table_name="watchlist_tickers")
    op.drop_table("watchlist_tickers")


def downgrade() -> None:
    op.create_table(
        "watchlist_tickers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("realtime_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("symbol", name="uq_watchlist_tickers_symbol"),
    )
    op.create_index("ix_watchlist_tickers_symbol", "watchlist_tickers", ["symbol"])

    op.create_table(
        "watchlist_tags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("color", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_watchlist_tags_name"),
    )
    op.create_index("ix_watchlist_tags_name", "watchlist_tags", ["name"])

    op.create_table(
        "watchlist_ticker_tags",
        sa.Column("ticker_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tag_id"], ["watchlist_tags.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ticker_id"], ["watchlist_tickers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("ticker_id", "tag_id"),
        sa.UniqueConstraint("ticker_id", "tag_id", name="uq_watchlist_ticker_tags_pair"),
    )
