from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class MarketProviderStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    provider: str
    feed: str
    status: str
    connected_at: datetime | None
    disconnected_at: datetime | None
    last_message_at: datetime | None
    message_count: int
    subscribed_symbols: list[str] | None
    subscribed_count: int
    error_message: str | None
    updated_at: datetime


class MarketQuoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    symbol: str
    provider: str
    feed: str
    market_session: str | None
    last_price: Decimal | None
    bid_price: Decimal | None
    ask_price: Decimal | None
    bid_ask_provider: str | None = None
    bid_ask_feed: str | None = None
    bid_ask_timestamp: datetime | None = None
    bid_ask_stale_seconds: int | None = None
    last_bar_close: Decimal | None
    previous_close: Decimal | None = None
    source_timestamp: datetime | None = None
    updated_at: datetime
    active_provider: str | None = None
    active_feed: str | None = None
    data_source: str | None = None
    is_stale: bool = False
    stale_seconds: int | None = None
    status_label: str | None = None
    reason: str | None = None


class MarketCandleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    symbol: str
    provider: str
    feed: str
    timeframe: str
    timestamp: datetime
    open: Decimal | None
    high: Decimal | None
    low: Decimal | None
    close: Decimal | None
    volume: Decimal | None
    vwap: Decimal | None


class MarketSubscriptionPlanResponse(BaseModel):
    """Realtime subscription plan: which symbols are streamed and how the
    Alpaca free-tier cap is being consumed. Powers the watchlist usage meter.
    """

    symbols: list[str]
    max_symbols: int
    total_candidates: int
    subscribed_count: int
    overflow_count: int
    holdings_count: int
    watchlist_realtime_count: int
    excluded_symbols: list[str]
    warnings: list[str]


class MarketSubscriptionRequest(BaseModel):
    """Reserved request body for subscribing a non-held symbol to realtime data."""

    symbol: str
