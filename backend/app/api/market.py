from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import MarketCandle, MarketProviderStatus, MarketQuote
from app.models.market_data import utc_now
from app.schemas import (
    MarketCandleResponse,
    MarketProviderStatusResponse,
    MarketQuoteResponse,
    MarketSubscriptionPlanResponse,
    MarketSubscriptionRequest,
)
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
    bid_ask_quote = _select_bid_ask_quote(selected, quotes)
    return _quote_response(
        selected,
        bid_ask_quote=bid_ask_quote,
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
    rows = list(
        db.scalars(
            select(MarketCandle)
            .where(MarketCandle.symbol == normalized_symbol)
            .where(MarketCandle.timeframe == timeframe)
            .where(MarketCandle.timestamp >= start_at)
            .order_by(MarketCandle.timestamp.asc(), MarketCandle.provider.asc(), MarketCandle.feed.asc())
        ).all()
    )
    return _dedupe_candles(rows)


def _dedupe_candles(rows: list[MarketCandle]) -> list[MarketCandle]:
    """Keep one candle per timestamp when multiple providers cover the same minute.

    Alpaca data is preferred over Yahoo fallback; ties go to the most
    recently updated row.
    """
    best: dict[datetime, MarketCandle] = {}
    for row in rows:
        existing = best.get(row.timestamp)
        if existing is None or _candle_priority(row) > _candle_priority(existing):
            best[row.timestamp] = row
    return sorted(best.values(), key=lambda row: row.timestamp)


def _candle_priority(row: MarketCandle) -> tuple[int, datetime]:
    provider_rank = 1 if row.provider == "alpaca" else 0
    updated = row.updated_at
    if updated is not None and updated.tzinfo is None:
        updated = updated.replace(tzinfo=UTC)
    return (provider_rank, updated or datetime.min.replace(tzinfo=UTC))


@router.get("/subscriptions/preview", response_model=MarketSubscriptionPlanResponse)
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


@router.post("/subscriptions", status_code=501)
def create_market_subscription(payload: MarketSubscriptionRequest) -> dict[str, object]:
    # TODO(details-global): subscribe a non-held symbol to realtime data.
    # The mechanism already exists — setting WatchlistTicker.realtime_enabled
    # = True (creating the watchlist row if needed) makes
    # MarketDataSubscriptionService fold the symbol into the worker's plan,
    # subject to ALPACA_FREE_MAX_SYMBOLS. This endpoint is reserved and not yet
    # wired so the eviction policy can be designed first: when the plan is
    # already full, which existing symbol (if any) should be dropped to make
    # room for a manually-requested one. Until then we fail loudly rather than
    # silently accept a subscription that would never take effect.
    raise HTTPException(
        status_code=501,
        detail=(
            f"Realtime subscription for non-held symbol '{_normalize_symbol(payload.symbol)}' "
            "is not implemented yet."
        ),
    )


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
    bid_ask_quote: MarketQuote | None,
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

    bid_ask_timestamp = _bid_ask_timestamp(bid_ask_quote) if bid_ask_quote is not None else None
    return {
        "symbol": quote.symbol,
        "provider": quote.provider,
        "active_provider": active_provider,
        "active_feed": active_feed,
        "feed": quote.feed,
        "market_session": quote.market_session,
        "last_price": quote.last_price,
        "bid_price": bid_ask_quote.bid_price if bid_ask_quote is not None else None,
        "ask_price": bid_ask_quote.ask_price if bid_ask_quote is not None else None,
        "bid_ask_provider": bid_ask_quote.provider if bid_ask_quote is not None else None,
        "bid_ask_feed": bid_ask_quote.feed if bid_ask_quote is not None else None,
        "bid_ask_timestamp": bid_ask_timestamp,
        "bid_ask_stale_seconds": _stale_seconds(bid_ask_timestamp, now),
        "last_bar_close": quote.last_bar_close,
        "previous_close": _previous_close_value(quote),
        "source_timestamp": source_timestamp,
        "updated_at": quote.updated_at,
        "data_source": data_source,
        "is_stale": is_stale,
        "stale_seconds": stale_seconds,
        "status_label": status_label,
        "reason": reason,
    }


def _select_bid_ask_quote(selected: MarketQuote, quotes: list[MarketQuote]) -> MarketQuote | None:
    """Pick the row whose bid/ask should be displayed.

    The selected quote may come from a provider that never carries bid/ask
    (e.g. Yahoo); in that case fall back to the freshest row that has both
    sides so the UI can show the last known book with its real age.
    """
    if selected.bid_price is not None and selected.ask_price is not None:
        return selected
    candidates = [quote for quote in quotes if quote.bid_price is not None and quote.ask_price is not None]
    if not candidates:
        return selected if selected.bid_price is not None or selected.ask_price is not None else None
    return max(
        candidates,
        key=lambda quote: _bid_ask_timestamp(quote) or datetime.min.replace(tzinfo=UTC),
    )


def _bid_ask_timestamp(quote: MarketQuote) -> datetime | None:
    payload = quote.raw_payload
    if isinstance(payload, dict):
        value = payload.get("_bid_ask_timestamp")
        if isinstance(value, str):
            try:
                parsed = datetime.fromisoformat(value)
            except ValueError:
                parsed = None
            if parsed is not None:
                return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        # Older rows written before _bid_ask_timestamp existed: an Alpaca
        # quote message's own timestamp covers its bid/ask.
        if payload.get("T") == "q":
            raw_t = payload.get("t")
            if isinstance(raw_t, str):
                try:
                    parsed = datetime.fromisoformat(raw_t.replace("Z", "+00:00"))
                    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
                except ValueError:
                    pass
    if quote.source_timestamp is not None:
        source = quote.source_timestamp
        return source if source.tzinfo else source.replace(tzinfo=UTC)
    return None


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


def _previous_close_value(quote: MarketQuote) -> float | None:
    payload = quote.raw_payload
    if isinstance(payload, dict):
        value = payload.get("_previous_close")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
            return float(value)
    return None


def _raw_data_source(quote: MarketQuote) -> str:
    payload = quote.raw_payload
    if isinstance(payload, dict):
        value = payload.get("_data_source")
        if isinstance(value, str) and value:
            return value
    return "websocket"
