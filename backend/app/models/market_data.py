from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import DateTime, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


PAYLOAD_TYPE = JSON().with_variant(JSONB, "postgresql")
DECIMAL_TYPE = Numeric(20, 8)
SYMBOL_TYPE = String(32)
PROVIDER_TYPE = String(40)
FEED_TYPE = String(40)
SESSION_TYPE = String(40)
TIMEFRAME_TYPE = String(16)
STATUS_TYPE = String(40)


class MarketQuote(Base):
    __tablename__ = "market_quotes"
    __table_args__ = (
        UniqueConstraint("symbol", "provider", "feed", name="uq_market_quotes_symbol_provider_feed"),
        Index("ix_market_quotes_symbol", "symbol"),
        Index("ix_market_quotes_provider_feed", "provider", "feed"),
        Index("ix_market_quotes_symbol_provider_feed_source_timestamp", "symbol", "provider", "feed", "source_timestamp"),
        Index("ix_market_quotes_updated_at", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(SYMBOL_TYPE, nullable=False)
    provider: Mapped[str] = mapped_column(PROVIDER_TYPE, nullable=False)
    feed: Mapped[str] = mapped_column(FEED_TYPE, nullable=False)
    market_session: Mapped[str | None] = mapped_column(SESSION_TYPE, nullable=True)
    last_price: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    bid_price: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    ask_price: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    bid_size: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    ask_size: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    last_trade_price: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    last_bar_close: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    source_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
    raw_payload: Mapped[dict | None] = mapped_column(PAYLOAD_TYPE, nullable=True)

    @property
    def previous_close(self) -> float | None:
        """Previous session close, stored in raw_payload (Alpaca prevDailyBar /
        Yahoo previousClose). Exposed so both the batch quotes endpoint
        (from_attributes) and _serialize_quote can read it without a column."""
        payload = self.raw_payload
        if isinstance(payload, dict):
            value = payload.get("_previous_close")
            if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
                return float(value)
        return None


class MarketCandle(Base):
    __tablename__ = "market_candles"
    __table_args__ = (
        UniqueConstraint(
            "symbol",
            "provider",
            "feed",
            "timeframe",
            "timestamp",
            name="uq_market_candles_symbol_provider_feed_timeframe_timestamp",
        ),
        Index("ix_market_candles_symbol_timeframe_timestamp", "symbol", "timeframe", "timestamp"),
        Index("ix_market_candles_provider_feed", "provider", "feed"),
        Index("ix_market_candles_timestamp", "timestamp"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(SYMBOL_TYPE, nullable=False)
    provider: Mapped[str] = mapped_column(PROVIDER_TYPE, nullable=False)
    feed: Mapped[str] = mapped_column(FEED_TYPE, nullable=False)
    timeframe: Mapped[str] = mapped_column(TIMEFRAME_TYPE, nullable=False)
    market_session: Mapped[str | None] = mapped_column(SESSION_TYPE, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    open: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    high: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    low: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    close: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    volume: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    vwap: Mapped[Decimal | None] = mapped_column(DECIMAL_TYPE, nullable=True)
    trade_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    raw_payload: Mapped[dict | None] = mapped_column(PAYLOAD_TYPE, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class MarketProviderStatus(Base):
    __tablename__ = "market_provider_status"
    __table_args__ = (
        UniqueConstraint("provider", "feed", name="uq_market_provider_status_provider_feed"),
        Index("ix_market_provider_status_provider_feed", "provider", "feed"),
        Index("ix_market_provider_status_updated_at", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(PROVIDER_TYPE, nullable=False)
    feed: Mapped[str] = mapped_column(FEED_TYPE, nullable=False)
    status: Mapped[str] = mapped_column(STATUS_TYPE, nullable=False)
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disconnected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    message_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    subscribed_symbols: Mapped[list[str] | None] = mapped_column(PAYLOAD_TYPE, nullable=True)
    subscribed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
