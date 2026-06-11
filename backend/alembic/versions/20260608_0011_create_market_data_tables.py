"""Create market data tables.

Revision ID: 20260608_0011
Revises: 20260605_0010
Create Date: 2026-06-08
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260608_0011"
down_revision: str | Sequence[str] | None = "20260605_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

decimal = sa.Numeric(20, 8)


def upgrade() -> None:
    op.create_table(
        "market_quotes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("feed", sa.String(length=40), nullable=False),
        sa.Column("market_session", sa.String(length=40), nullable=True),
        sa.Column("last_price", decimal, nullable=True),
        sa.Column("bid_price", decimal, nullable=True),
        sa.Column("ask_price", decimal, nullable=True),
        sa.Column("bid_size", decimal, nullable=True),
        sa.Column("ask_size", decimal, nullable=True),
        sa.Column("last_trade_price", decimal, nullable=True),
        sa.Column("last_bar_close", decimal, nullable=True),
        sa.Column("source_timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("symbol", "provider", "feed", name="uq_market_quotes_symbol_provider_feed"),
    )
    op.create_index("ix_market_quotes_symbol", "market_quotes", ["symbol"])
    op.create_index("ix_market_quotes_provider_feed", "market_quotes", ["provider", "feed"])
    op.create_index("ix_market_quotes_updated_at", "market_quotes", ["updated_at"])

    op.create_table(
        "market_candles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("feed", sa.String(length=40), nullable=False),
        sa.Column("timeframe", sa.String(length=16), nullable=False),
        sa.Column("market_session", sa.String(length=40), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open", decimal, nullable=True),
        sa.Column("high", decimal, nullable=True),
        sa.Column("low", decimal, nullable=True),
        sa.Column("close", decimal, nullable=True),
        sa.Column("volume", decimal, nullable=True),
        sa.Column("vwap", decimal, nullable=True),
        sa.Column("trade_count", sa.Integer(), nullable=True),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "symbol",
            "provider",
            "feed",
            "timeframe",
            "timestamp",
            name="uq_market_candles_symbol_provider_feed_timeframe_timestamp",
        ),
    )
    op.create_index(
        "ix_market_candles_symbol_timeframe_timestamp",
        "market_candles",
        ["symbol", "timeframe", "timestamp"],
    )
    op.create_index("ix_market_candles_provider_feed", "market_candles", ["provider", "feed"])
    op.create_index("ix_market_candles_timestamp", "market_candles", ["timestamp"])

    op.create_table(
        "market_provider_status",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("feed", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disconnected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("message_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("subscribed_symbols", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("subscribed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "feed", name="uq_market_provider_status_provider_feed"),
    )
    op.create_index("ix_market_provider_status_provider_feed", "market_provider_status", ["provider", "feed"])
    op.create_index("ix_market_provider_status_updated_at", "market_provider_status", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_market_provider_status_updated_at", table_name="market_provider_status")
    op.drop_index("ix_market_provider_status_provider_feed", table_name="market_provider_status")
    op.drop_table("market_provider_status")

    op.drop_index("ix_market_candles_timestamp", table_name="market_candles")
    op.drop_index("ix_market_candles_provider_feed", table_name="market_candles")
    op.drop_index("ix_market_candles_symbol_timeframe_timestamp", table_name="market_candles")
    op.drop_table("market_candles")

    op.drop_index("ix_market_quotes_updated_at", table_name="market_quotes")
    op.drop_index("ix_market_quotes_provider_feed", table_name="market_quotes")
    op.drop_index("ix_market_quotes_symbol", table_name="market_quotes")
    op.drop_table("market_quotes")
