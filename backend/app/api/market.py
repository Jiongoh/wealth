from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import MarketCandle, MarketProviderStatus, MarketQuote
from app.models.market_data import utc_now
from app.schemas import MarketCandleResponse, MarketProviderStatusResponse, MarketQuoteResponse
from app.services.alpaca_feed import resolve_market_data_route
from app.services.market_data_subscription import MarketDataSubscriptionService

router = APIRouter(prefix="/market", tags=["market"])
REALTIME_STALE_SECONDS = 120


def get_market_settings() -> Settings:
    return get_settings()


@router.get("/status", response_model=list[MarketProviderStatusResponse])
def get_market_status(db: Session = Depends(get_db)) -> list[MarketProviderStatus]:
    return list(
        db.scalars(
            select(MarketProviderStatus).order_by(
                MarketProviderStatus.updated_at.desc(),
                MarketProviderStatus.provider.asc(),
                MarketProviderStatus.feed.asc(),
            )
        ).all()
    )


@router.get("/quotes", response_model=list[MarketQuoteResponse])
def get_market_quotes(db: Session = Depends(get_db)) -> list[MarketQuote]:
    return list(
        db.scalars(
            select(MarketQuote).order_by(
                MarketQuote.symbol.asc(),
                MarketQuote.provider.asc(),
                MarketQuote.feed.asc(),
            )
        ).all()
    )


@router.get("/quotes/{symbol}", response_model=MarketQuoteResponse | None)
def get_market_quote(
    symbol: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_market_settings),
) -> dict[str, object] | None:
    normalized_symbol = _normalize_symbol(symbol)
    if not normalized_symbol:
        return None
    route = resolve_market_data_route(settings.alpaca_feed_mode)
    quotes = list(
        db.scalars(
            select(MarketQuote)
            .where(MarketQuote.symbol == normalized_symbol)
            .order_by(
                func.coalesce(MarketQuote.source_timestamp, MarketQuote.updated_at).desc(),
                MarketQuote.updated_at.desc(),
                MarketQuote.provider.asc(),
                MarketQuote.feed.asc(),
            )
        ).all()
    )
    if not quotes:
        return None

    active_quote = next(
        (
            quote
            for quote in quotes
            if quote.provider == route.active_provider and quote.feed == route.active_feed
        ),
        None,
    )
    yahoo_quote = next((quote for quote in quotes if quote.provider == "yahoo" and quote.feed == "yahoo"), None)
    latest_available = quotes[0]
    active_status = db.scalar(
        select(MarketProviderStatus)
        .where(MarketProviderStatus.provider == route.active_provider)
        .where(MarketProviderStatus.feed == route.active_feed)
    )
    selected = _select_market_quote(active_quote=active_quote, yahoo_quote=yahoo_quote, latest_available=latest_available)
    return _quote_response(
        selected,
        active_provider=route.active_provider,
        active_feed=route.active_feed,
        active_status=active_status,
        fallback=selected.provider != route.active_provider or selected.feed != route.active_feed,
        reason=route.reason,
    )


@router.get("/candles/{symbol}", response_model=list[MarketCandleResponse])
def get_market_candles(
    symbol: str,
    timeframe: str = Query(default="1m"),
    range_value: str = Query(default="1d", alias="range"),
    db: Session = Depends(get_db),
) -> list[MarketCandle]:
    normalized_symbol = _normalize_symbol(symbol)
    if not normalized_symbol:
        return []

    start_at = utc_now() - _range_delta(range_value)
    return list(
        db.scalars(
            select(MarketCandle)
            .where(MarketCandle.symbol == normalized_symbol)
            .where(MarketCandle.timeframe == timeframe)
            .where(MarketCandle.timestamp >= start_at)
            .order_by(MarketCandle.timestamp.asc(), MarketCandle.provider.asc(), MarketCandle.feed.asc())
        ).all()
    )


@router.get("/subscriptions/preview")
def preview_market_data_subscriptions(
    max_symbols: int | None = Query(default=None, ge=0),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_market_settings),
) -> dict[str, object]:
    limit = settings.alpaca_max_symbols if max_symbols is None else max_symbols
    return MarketDataSubscriptionService().get_subscription_symbols(
        db,
        max_symbols=limit,
    ).to_dict()


def _normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def _range_delta(value: str) -> timedelta:
    normalized = value.strip().lower()
    ranges = {
        "1h": timedelta(hours=1),
        "1d": timedelta(days=1),
        "5d": timedelta(days=5),
        "1mo": timedelta(days=31),
        "3mo": timedelta(days=93),
        "6mo": timedelta(days=186),
        "1y": timedelta(days=366),
    }
    try:
        return ranges[normalized]
    except KeyError as exc:
        raise HTTPException(
            status_code=400,
            detail="range must be one of 1h, 1d, 5d, 1mo, 3mo, 6mo, 1y",
        ) from exc


def _quote_response(
    quote: MarketQuote,
    *,
    active_provider: str,
    active_feed: str,
    active_status: MarketProviderStatus | None,
    fallback: bool,
    reason: str,
) -> dict[str, object]:
    source_timestamp = quote.source_timestamp
    now = utc_now()
    stale_seconds = _stale_seconds(source_timestamp, now)
    raw_data_source = _raw_data_source(quote)
    fresh_by_time = stale_seconds is not None and stale_seconds <= REALTIME_STALE_SECONDS
    data_source = raw_data_source if quote.provider == "yahoo" and fresh_by_time else ("latest_available" if fallback else raw_data_source)
    websocket_receiving = (
        not fallback
        and quote.provider == "alpaca"
        and raw_data_source == "websocket"
        and active_status is not None
        and active_status.status == "connected_receiving"
    )
    yahoo_polling = (
        not fallback
        and quote.provider == "yahoo"
        and raw_data_source.startswith("yahoo_")
        and active_status is not None
        and active_status.status in {"polling", "polling_no_data"}
    )
    is_stale = stale_seconds is None or stale_seconds > REALTIME_STALE_SECONDS
    if not fallback:
        is_stale = is_stale or not (websocket_receiving or yahoo_polling)
    if fallback:
        status_label = "fallback" if quote.provider == "yahoo" and not is_stale else "latest_available"
    elif websocket_receiving and not is_stale:
        status_label = "realtime"
    elif yahoo_polling and not is_stale:
        status_label = "fallback"
    elif raw_data_source in {"rest_bootstrap", "rest_fallback"}:
        status_label = "delayed"
    else:
        status_label = "stale"

    return {
        "symbol": quote.symbol,
        "provider": quote.provider,
        "active_provider": active_provider,
        "active_feed": active_feed,
        "feed": quote.feed,
        "market_session": quote.market_session,
        "last_price": quote.last_price,
        "bid_price": quote.bid_price,
        "ask_price": quote.ask_price,
        "last_bar_close": quote.last_bar_close,
        "source_timestamp": source_timestamp,
        "updated_at": quote.updated_at,
        "data_source": data_source,
        "is_stale": is_stale,
        "stale_seconds": stale_seconds,
        "status_label": status_label,
        "reason": reason,
    }


def _select_market_quote(
    *,
    active_quote: MarketQuote | None,
    yahoo_quote: MarketQuote | None,
    latest_available: MarketQuote,
) -> MarketQuote:
    if active_quote is not None and _is_fresh(active_quote):
        return active_quote
    if yahoo_quote is not None and _is_fresh(yahoo_quote):
        return yahoo_quote
    return latest_available


def _is_fresh(quote: MarketQuote) -> bool:
    seconds = _stale_seconds(quote.source_timestamp, utc_now())
    return seconds is not None and seconds <= REALTIME_STALE_SECONDS


def _stale_seconds(source_timestamp: datetime | None, now: datetime) -> int | None:
    if source_timestamp is None:
        return None
    source = source_timestamp
    if source.tzinfo is None:
        source = source.replace(tzinfo=UTC)
    return max(0, int((now - source.astimezone(UTC)).total_seconds()))


def _raw_data_source(quote: MarketQuote) -> str:
    payload = quote.raw_payload
    if isinstance(payload, dict):
        value = payload.get("_data_source")
        if isinstance(value, str) and value:
            return value
    return "websocket"
