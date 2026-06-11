import argparse
import asyncio
import json
import logging
import os
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal

import httpx
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
import websockets

from app.core.logging import configure_logging
from app.models import MarketCandle, MarketProviderStatus, MarketQuote
from app.models.market_data import utc_now
from app.services.alpaca_feed import NEW_YORK_TZ, next_alpaca_feed_switch, resolve_alpaca_feed, resolve_market_data_route
from app.services.market_data_retention import MarketDataCleanupResult, cleanup_market_data
from app.services.market_data_subscription import MarketDataSubscriptionService
from app.services.yahoo_provider import YahooCandle, YahooMarketDataProvider, YahooProviderUnavailable, YahooQuote

logger = logging.getLogger(__name__)
ALPACA_STREAM_URLS = {
    "iex": "wss://stream.data.alpaca.markets/v2/iex",
    "overnight": "wss://stream.data.alpaca.markets/v1beta1/overnight",
    "test": "wss://stream.data.alpaca.markets/v2/test",
}
ALPACA_REST_BASE_URL = "https://data.alpaca.markets/v2/stocks"
INITIAL_RECONNECT_SECONDS = 1.0
MAX_RECONNECT_SECONDS = 60.0
STREAM_RECV_TIMEOUT_SECONDS = 30.0
REST_FALLBACK_INTERVAL_SECONDS = 30.0


@dataclass(frozen=True)
class MarketDataWorkerSettings:
    database_url: str
    log_level: str
    market_data_provider: str
    alpaca_api_key_id: str
    alpaca_api_secret_key: str
    alpaca_feed_mode: str
    alpaca_max_symbols: int
    yahoo_fallback_enabled: bool
    yahoo_fallback_mode: str
    yahoo_fallback_interval_seconds: int
    yahoo_fallback_max_symbols: int
    yahoo_fallback_write_candles: bool
    yahoo_fallback_timeout_seconds: float
    market_data_retention_minutes: int
    market_data_cleanup_interval_seconds: int
    market_data_status_retention_days: int


@dataclass(frozen=True)
class BootstrapResult:
    symbols_requested: int
    quote_symbols_returned: int = 0
    bar_symbols_returned: int = 0
    quote_rows_upserted: int = 0
    candle_rows_upserted: int = 0


@dataclass
class StreamCounters:
    received_quotes: int = 0
    received_bars: int = 0
    upserted_quotes: int = 0
    upserted_candles: int = 0

    @property
    def received_total(self) -> int:
        return self.received_quotes + self.received_bars

    @property
    def upserted_total(self) -> int:
        return self.upserted_quotes + self.upserted_candles


@dataclass
class YahooCounters:
    poll_count: int = 0
    quote_rows_upserted: int = 0
    candle_rows_upserted: int = 0


def load_worker_settings() -> MarketDataWorkerSettings:
    return MarketDataWorkerSettings(
        database_url=os.getenv("DATABASE_URL", ""),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        market_data_provider=os.getenv("MARKET_DATA_PROVIDER", "alpaca").lower(),
        alpaca_api_key_id=os.getenv("ALPACA_API_KEY_ID", ""),
        alpaca_api_secret_key=os.getenv("ALPACA_API_SECRET_KEY", ""),
        alpaca_feed_mode=os.getenv("ALPACA_FEED_MODE", "auto").lower(),
        alpaca_max_symbols=int(os.getenv("ALPACA_MAX_SYMBOLS", "30")),
        yahoo_fallback_enabled=_parse_bool(os.getenv("YAHOO_FALLBACK_ENABLED", "true")),
        yahoo_fallback_mode=os.getenv("YAHOO_FALLBACK_MODE", "auto").lower(),
        yahoo_fallback_interval_seconds=int(os.getenv("YAHOO_FALLBACK_INTERVAL_SECONDS", "15")),
        yahoo_fallback_max_symbols=int(os.getenv("YAHOO_FALLBACK_MAX_SYMBOLS", "30")),
        yahoo_fallback_write_candles=_parse_bool(os.getenv("YAHOO_FALLBACK_WRITE_CANDLES", "true")),
        yahoo_fallback_timeout_seconds=float(os.getenv("YAHOO_FALLBACK_TIMEOUT_SECONDS", "10")),
        market_data_retention_minutes=int(os.getenv("MARKET_DATA_RETENTION_MINUTES", "60")),
        market_data_cleanup_interval_seconds=int(os.getenv("MARKET_DATA_CLEANUP_INTERVAL_SECONDS", "300")),
        market_data_status_retention_days=int(os.getenv("MARKET_DATA_STATUS_RETENTION_DAYS", "7")),
    )


def alpaca_stream_url(feed: str) -> str:
    try:
        return ALPACA_STREAM_URLS[feed]
    except KeyError as exc:
        raise ValueError(f"Unsupported Alpaca feed: {feed}") from exc


def run_dry_run(settings: MarketDataWorkerSettings) -> dict[str, object]:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL must be set before running market-data-worker")
    if settings.market_data_provider != "alpaca":
        raise ValueError("Only MARKET_DATA_PROVIDER=alpaca is supported for market-data-worker dry-run")

    feed = resolve_alpaca_feed(settings.alpaca_feed_mode)
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    try:
        with session_factory() as db:
            plan = MarketDataSubscriptionService().get_subscription_symbols(
                db,
                max_symbols=settings.alpaca_max_symbols,
            )
            _write_provider_status(
                db,
                provider=settings.market_data_provider,
                feed=feed,
                status_value="dry_run",
                symbols=plan.symbols,
            )
            result = plan.to_dict()
            result["provider"] = settings.market_data_provider
            result["feed"] = feed
            result["status"] = "dry_run"
            return result
    finally:
        engine.dispose()


def _write_provider_status(
    db: Session,
    *,
    provider: str,
    feed: str,
    status_value: str,
    symbols: list[str],
    connected_at: datetime | None = None,
    disconnected_at: datetime | None = None,
    last_message_at: datetime | None = None,
    message_count: int | None = None,
    error_message: str | None = None,
) -> None:
    status = db.scalar(
        select(MarketProviderStatus)
        .where(MarketProviderStatus.provider == provider)
        .where(MarketProviderStatus.feed == feed)
    )
    now = utc_now()
    if status is None:
        status = MarketProviderStatus(
            provider=provider,
            feed=feed,
            status=status_value,
        )
        db.add(status)

    status.status = status_value
    status.connected_at = connected_at
    status.disconnected_at = disconnected_at
    status.last_message_at = last_message_at
    if message_count is not None:
        status.message_count = message_count
    status.subscribed_symbols = symbols
    status.subscribed_count = len(symbols)
    status.error_message = error_message
    status.updated_at = now
    db.commit()


async def run_worker(
    settings: MarketDataWorkerSettings,
    *,
    max_messages: int | None = None,
    max_runtime_seconds: int | None = None,
    feed_override: str | None = None,
    log_messages: bool = False,
    print_db_counts: bool = False,
    test_stream: bool = False,
) -> None:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL must be set before running market-data-worker")
    if settings.market_data_provider != "alpaca":
        raise ValueError("Only MARKET_DATA_PROVIDER=alpaca is supported for market-data-worker")
    if not settings.alpaca_api_key_id or not settings.alpaca_api_secret_key:
        raise RuntimeError("ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY are required outside --dry-run")

    engine = create_engine(settings.database_url, pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    backoff = INITIAL_RECONNECT_SECONDS
    processed_total = 0
    bootstrapped = False
    cleanup_task = asyncio.create_task(_run_cleanup_loop(session_factory, settings=settings))
    try:
        while True:
            ny_time = datetime.now(NEW_YORK_TZ)
            feed_mode = feed_override or settings.alpaca_feed_mode
            route = None if test_stream else resolve_market_data_route(feed_mode, ny_time)
            feed = "test" if test_stream else route.active_feed
            next_switch = None if test_stream else route.next_switch_time
            switch_runtime_seconds = None
            if next_switch is not None:
                switch_runtime_seconds = max(1, int((next_switch - ny_time).total_seconds()))
            run_runtime_seconds = max_runtime_seconds
            if run_runtime_seconds is None:
                run_runtime_seconds = switch_runtime_seconds
            elif switch_runtime_seconds is not None:
                run_runtime_seconds = min(run_runtime_seconds, switch_runtime_seconds)

            with session_factory() as db:
                if test_stream:
                    symbols = ["FAKEPACA"]
                else:
                    plan = MarketDataSubscriptionService().get_subscription_symbols(
                        db,
                        max_symbols=min(settings.alpaca_max_symbols, settings.yahoo_fallback_max_symbols),
                    )
                    symbols = plan.symbols
                if not symbols:
                    _write_provider_status(
                        db,
                        provider=settings.market_data_provider,
                        feed=feed,
                        status_value="stopped",
                        symbols=[],
                        disconnected_at=utc_now(),
                        message_count=0,
                    )
                    logger.warning("market-data-worker stopped: no subscription symbols")
                    return

                active_provider = "alpaca" if test_stream else route.active_provider
                active_feed = feed
                _write_provider_status(
                    db,
                    provider=active_provider,
                    feed=active_feed,
                    status_value="connecting",
                    symbols=symbols,
                    message_count=0,
                    error_message=None,
                )

            if not test_stream and route.active_provider == "yahoo":
                logger.info(
                    "market-data-worker yahoo active route provider=yahoo feed=yahoo ny_time=%s next_switch_time=%s reason=%s subscribed_symbols=%s",
                    ny_time.isoformat(),
                    next_switch.isoformat() if next_switch else None,
                    route.reason,
                    symbols,
                )
                await _run_yahoo_poll_until_switch(
                    session_factory,
                    settings=settings,
                    symbols=symbols,
                    max_runtime_seconds=run_runtime_seconds,
                )
                if max_runtime_seconds is not None:
                    return
                continue

            url = alpaca_stream_url(feed)

            if not bootstrapped and not test_stream:
                bootstrap = _bootstrap_latest_data(
                    session_factory,
                    settings=settings,
                    feed=feed,
                    symbols=symbols,
                    data_source="rest_bootstrap",
                )
                logger.info(
                    "market-data-worker bootstrap result provider=%s feed=%s symbols_requested=%s quote_symbols_returned=%s bar_symbols_returned=%s quote_rows_upserted=%s candle_rows_upserted=%s",
                    settings.market_data_provider,
                    feed,
                    bootstrap.symbols_requested,
                    bootstrap.quote_symbols_returned,
                    bootstrap.bar_symbols_returned,
                    bootstrap.quote_rows_upserted,
                    bootstrap.candle_rows_upserted,
                )
                bootstrapped = True
            elif test_stream and not bootstrapped:
                logger.info(
                    "market-data-worker test stream skips REST bootstrap provider=%s feed=%s symbols=%s",
                    settings.market_data_provider,
                    feed,
                    symbols,
                )
                bootstrapped = True

            logger.info(
                "market-data-worker connecting provider=%s feed=%s url=%s ny_time=%s next_switch_time=%s subscribed_symbols=%s key_exists=%s secret_exists=%s secret_length=%s test_stream=%s",
                settings.market_data_provider,
                feed,
                url,
                ny_time.isoformat(),
                next_switch.isoformat() if next_switch else None,
                symbols,
                bool(settings.alpaca_api_key_id),
                bool(settings.alpaca_api_secret_key),
                len(settings.alpaca_api_secret_key),
                test_stream,
            )
            try:
                remaining = None if max_messages is None else max_messages - processed_total
                processed = await _run_alpaca_stream_once(
                    session_factory,
                    settings=settings,
                    feed=feed,
                    url=url,
                    symbols=symbols,
                    max_messages=remaining,
                    max_runtime_seconds=run_runtime_seconds,
                    log_messages=log_messages,
                )
                processed_total += processed
                if max_messages is not None and processed_total >= max_messages:
                    logger.info("market-data-worker max_messages reached: %s", processed_total)
                    if print_db_counts:
                        _log_db_counts(session_factory, provider=settings.market_data_provider, feed=feed)
                    return
                if max_runtime_seconds is not None:
                    logger.info(
                        "market-data-worker max_runtime_seconds reached: %s message_count=%s",
                        max_runtime_seconds,
                        processed_total,
                    )
                    if print_db_counts:
                        _log_db_counts(session_factory, provider=settings.market_data_provider, feed=feed)
                    return
                if next_switch is not None:
                    logger.info(
                        "market-data-worker feed switch boundary reached provider=%s old_feed=%s ny_time=%s next_switch_time=%s",
                        settings.market_data_provider,
                        feed,
                        datetime.now(NEW_YORK_TZ).isoformat(),
                        next_switch.isoformat(),
                    )
                    continue
                backoff = INITIAL_RECONNECT_SECONDS
            except Exception as exc:
                with session_factory() as db:
                    _write_provider_status(
                        db,
                        provider=settings.market_data_provider,
                        feed=feed,
                        status_value="error",
                        symbols=symbols,
                        disconnected_at=utc_now(),
                        error_message=_safe_error_message(exc),
                    )
                logger.error(
                    "market-data-worker stream error provider=%s feed=%s error=%s reconnect_in_seconds=%.1f",
                    settings.market_data_provider,
                    feed,
                    _safe_error_message(exc),
                    backoff,
                )
                if max_messages is not None:
                    raise
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, MAX_RECONNECT_SECONDS)
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass
        engine.dispose()


async def _run_alpaca_stream_once(
    session_factory,
    *,
    settings: MarketDataWorkerSettings,
    feed: str,
    url: str,
    symbols: list[str],
    max_messages: int | None,
    max_runtime_seconds: int | None,
    log_messages: bool,
) -> int:
    if max_messages is not None and max_messages <= 0:
        return 0

    connected_at: datetime | None = None
    counters = StreamCounters()
    processed = 0
    first_message_at: datetime | None = None
    last_rest_fallback_at: float | None = None
    runtime_deadline = (
        asyncio.get_running_loop().time() + max_runtime_seconds
        if max_runtime_seconds is not None
        else None
    )
    async with websockets.connect(url, ping_interval=20, ping_timeout=20) as websocket:
        await websocket.send(
            json.dumps(
                {
                    "action": "auth",
                    "key": settings.alpaca_api_key_id,
                    "secret": settings.alpaca_api_secret_key,
                }
            )
        )
        await _await_authenticated(websocket)
        with session_factory() as db:
            _write_provider_status(
                db,
                provider=settings.market_data_provider,
                feed=feed,
                status_value="authenticated",
                symbols=symbols,
                message_count=0,
                error_message=None,
            )
        logger.info("market-data-worker auth result provider=%s feed=%s status=authenticated", settings.market_data_provider, feed)
        await websocket.send(json.dumps({"action": "subscribe", "quotes": symbols, "bars": symbols}))
        await _await_subscription(websocket)

        connected_at = utc_now()
        with session_factory() as db:
            _write_provider_status(
                db,
                provider=settings.market_data_provider,
                feed=feed,
                status_value="subscribed",
                symbols=symbols,
                connected_at=connected_at,
                message_count=0,
            )
        logger.info(
            "market-data-worker subscribe result provider=%s feed=%s status=subscribed subscribed_count=%s",
            settings.market_data_provider,
            feed,
            len(symbols),
        )

        while True:
            recv_timeout = STREAM_RECV_TIMEOUT_SECONDS
            if runtime_deadline is not None:
                remaining_runtime = runtime_deadline - asyncio.get_running_loop().time()
                if remaining_runtime <= 0:
                    break
                recv_timeout = min(remaining_runtime, STREAM_RECV_TIMEOUT_SECONDS)
            try:
                raw_message = await asyncio.wait_for(websocket.recv(), timeout=recv_timeout)
            except TimeoutError:
                if counters.received_total == 0:
                    with session_factory() as db:
                        _write_provider_status(
                            db,
                            provider=settings.market_data_provider,
                            feed=feed,
                            status_value="subscribed_no_messages",
                            symbols=symbols,
                            connected_at=connected_at,
                            message_count=0,
                            error_message=None,
                        )
                    logger.info(
                        "market-data-worker subscribed_no_messages provider=%s feed=%s subscribed_count=%s wait_seconds=%.0f",
                        settings.market_data_provider,
                        feed,
                        len(symbols),
                        STREAM_RECV_TIMEOUT_SECONDS,
                    )
                current_loop_time = asyncio.get_running_loop().time()
                if (
                    last_rest_fallback_at is None
                    or current_loop_time - last_rest_fallback_at >= REST_FALLBACK_INTERVAL_SECONDS
                ):
                    yahoo_fallback = await _run_yahoo_poll_once(
                        session_factory,
                        settings=settings,
                        symbols=symbols,
                    )
                    fallback = _bootstrap_latest_data(
                        session_factory,
                        settings=settings,
                        feed=feed,
                        symbols=symbols,
                        data_source="rest_fallback",
                    )
                    last_rest_fallback_at = current_loop_time
                    logger.info(
                        "market-data-worker rest fallback result provider=%s feed=%s symbols_requested=%s quote_symbols_returned=%s bar_symbols_returned=%s quote_rows_upserted=%s candle_rows_upserted=%s",
                        settings.market_data_provider,
                        feed,
                        fallback.symbols_requested,
                        fallback.quote_symbols_returned,
                        fallback.bar_symbols_returned,
                        fallback.quote_rows_upserted,
                        fallback.candle_rows_upserted,
                    )
                    logger.info(
                        "market-data-worker yahoo fallback result provider=yahoo feed=yahoo poll_count=%s quote_rows_upserted=%s candle_rows_upserted=%s",
                        yahoo_fallback.poll_count,
                        yahoo_fallback.quote_rows_upserted,
                        yahoo_fallback.candle_rows_upserted,
                    )
                continue

            messages = _decode_ws_messages(raw_message)
            control_errors = [message for message in messages if message.get("T") == "error"]
            if control_errors:
                raise RuntimeError(_control_error_message(control_errors[0]))
            market_messages = [message for message in messages if message.get("T") in {"q", "b"}]
            if not market_messages:
                continue

            with session_factory() as db:
                for message in market_messages:
                    message_kind = str(message.get("T"))
                    if message_kind == "q":
                        counters.received_quotes += 1
                    elif message_kind == "b":
                        counters.received_bars += 1
                    stored_kind = _store_market_message(
                        db,
                        provider=settings.market_data_provider,
                        feed=feed,
                        message=message,
                        data_source="websocket",
                    )
                    if stored_kind == "quote":
                        counters.upserted_quotes += 1
                    elif stored_kind == "candle":
                        counters.upserted_candles += 1
                    processed += 1
                    if log_messages:
                        logger.info(
                            "market-data-worker live message type=%s symbol=%s feed=%s received_quotes=%s received_bars=%s upserted_quotes=%s upserted_candles=%s",
                            message.get("T"),
                            message.get("S"),
                            feed,
                            counters.received_quotes,
                            counters.received_bars,
                            counters.upserted_quotes,
                            counters.upserted_candles,
                        )
                _touch_provider_status(
                    db,
                    provider=settings.market_data_provider,
                    feed=feed,
                    symbols=symbols,
                    message_count=counters.received_total,
                )
            if first_message_at is None:
                first_message_at = utc_now()
                logger.info(
                    "market-data-worker first payload received provider=%s feed=%s first_payload_received_time=%s received_quotes=%s received_bars=%s upserted_quotes=%s upserted_candles=%s",
                    settings.market_data_provider,
                    feed,
                    first_message_at.isoformat(),
                    counters.received_quotes,
                    counters.received_bars,
                    counters.upserted_quotes,
                    counters.upserted_candles,
                )
            if max_messages is not None and processed >= max_messages:
                with session_factory() as db:
                    _write_provider_status(
                        db,
                        provider=settings.market_data_provider,
                        feed=feed,
                        status_value="disconnected",
                        symbols=symbols,
                        connected_at=connected_at,
                        disconnected_at=utc_now(),
                        last_message_at=utc_now(),
                        message_count=counters.received_total,
                )
                logger.info(
                    "market-data-worker stream summary provider=%s feed=%s received_quotes=%s received_bars=%s upserted_quotes=%s upserted_candles=%s",
                    settings.market_data_provider,
                    feed,
                    counters.received_quotes,
                    counters.received_bars,
                    counters.upserted_quotes,
                    counters.upserted_candles,
                )
                return processed

    with session_factory() as db:
        status_value = "disconnected" if counters.received_total else "subscribed_no_messages"
        _write_provider_status(
            db,
            provider=settings.market_data_provider,
            feed=feed,
            status_value=status_value,
            symbols=symbols,
            connected_at=connected_at,
            disconnected_at=utc_now(),
            last_message_at=utc_now() if counters.received_total else None,
            message_count=counters.received_total,
            error_message=None,
        )
    logger.info(
        "market-data-worker stream summary provider=%s feed=%s received_quotes=%s received_bars=%s upserted_quotes=%s upserted_candles=%s",
        settings.market_data_provider,
        feed,
        counters.received_quotes,
        counters.received_bars,
        counters.upserted_quotes,
        counters.upserted_candles,
    )
    return processed


async def _run_yahoo_poll_until_switch(
    session_factory,
    *,
    settings: MarketDataWorkerSettings,
    symbols: list[str],
    max_runtime_seconds: int | None,
) -> YahooCounters:
    counters = YahooCounters()
    deadline = (
        asyncio.get_running_loop().time() + max_runtime_seconds
        if max_runtime_seconds is not None
        else None
    )
    with session_factory() as db:
        _write_provider_status(
            db,
            provider="yahoo",
            feed="yahoo",
            status_value="polling",
            symbols=symbols,
            connected_at=utc_now(),
            message_count=0,
            error_message=None,
        )

    while True:
        result = await _run_yahoo_poll_once(
            session_factory,
            settings=settings,
            symbols=symbols,
            cumulative_count=counters.poll_count,
        )
        counters.poll_count += result.poll_count
        counters.quote_rows_upserted += result.quote_rows_upserted
        counters.candle_rows_upserted += result.candle_rows_upserted
        if deadline is not None:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            sleep_seconds = min(settings.yahoo_fallback_interval_seconds, remaining)
        else:
            sleep_seconds = settings.yahoo_fallback_interval_seconds
        await asyncio.sleep(max(1, sleep_seconds))
    return counters


async def _run_yahoo_poll_once(
    session_factory,
    *,
    settings: MarketDataWorkerSettings,
    symbols: list[str],
    cumulative_count: int = 0,
) -> YahooCounters:
    if not settings.yahoo_fallback_enabled:
        with session_factory() as db:
            _write_provider_status(
                db,
                provider="yahoo",
                feed="yahoo",
                status_value="disabled",
                symbols=symbols,
                message_count=cumulative_count,
                error_message="Yahoo fallback disabled by configuration",
            )
        return YahooCounters()
    selected_symbols = symbols[: settings.yahoo_fallback_max_symbols]
    provider = YahooMarketDataProvider(timeout_seconds=settings.yahoo_fallback_timeout_seconds)
    try:
        quotes = await provider.fetch_latest_quotes(selected_symbols)
    except YahooProviderUnavailable as exc:
        with session_factory() as db:
            _write_provider_status(
                db,
                provider="yahoo",
                feed="yahoo",
                status_value="disabled",
                symbols=selected_symbols,
                message_count=cumulative_count,
                error_message=_safe_error_message(exc),
            )
        logger.warning("market-data-worker yahoo fallback disabled: %s", _safe_error_message(exc))
        return YahooCounters()
    except Exception as exc:
        with session_factory() as db:
            _write_provider_status(
                db,
                provider="yahoo",
                feed="yahoo",
                status_value="error",
                symbols=selected_symbols,
                message_count=cumulative_count,
                error_message=_safe_error_message(exc),
            )
        logger.warning("market-data-worker yahoo fallback warning error=%s", _safe_error_message(exc))
        return YahooCounters()
    candles: list[YahooCandle] = []
    if settings.yahoo_fallback_write_candles:
        try:
            candles = await provider.fetch_latest_candles(selected_symbols)
        except Exception as exc:
            logger.warning(
                "market-data-worker yahoo candle fallback warning symbols_requested=%s error=%s",
                len(selected_symbols),
                _safe_error_message(exc),
            )

    quote_rows = 0
    candle_rows = 0
    with session_factory() as db:
        for quote in quotes:
            if _upsert_yahoo_quote(db, quote):
                quote_rows += 1
        for candle in candles:
            if _upsert_yahoo_candle(db, candle):
                candle_rows += 1
        db.commit()
        status_value = "polling" if quote_rows or candle_rows else "polling_no_data"
        _write_provider_status(
            db,
            provider="yahoo",
            feed="yahoo",
            status_value=status_value,
            symbols=selected_symbols,
            connected_at=utc_now(),
            last_message_at=utc_now() if quote_rows or candle_rows else None,
            message_count=cumulative_count + 1,
            error_message=None,
        )
    logger.info(
        "market-data-worker yahoo fallback result provider=yahoo feed=yahoo status=%s symbols_requested=%s poll_count=%s quote_rows_upserted=%s candle_rows_upserted=%s",
        status_value,
        len(selected_symbols),
        cumulative_count + 1,
        quote_rows,
        candle_rows,
    )
    return YahooCounters(poll_count=1, quote_rows_upserted=quote_rows, candle_rows_upserted=candle_rows)


async def _await_authenticated(websocket) -> None:
    while True:
        messages = _decode_ws_messages(await websocket.recv())
        for message in messages:
            if message.get("T") == "success" and message.get("msg") == "authenticated":
                return
            if message.get("T") == "error":
                raise RuntimeError(_control_error_message(message))


async def _await_subscription(websocket) -> None:
    while True:
        messages = _decode_ws_messages(await websocket.recv())
        for message in messages:
            if message.get("T") == "subscription":
                return
            if message.get("T") == "error":
                raise RuntimeError(_control_error_message(message))


def _decode_ws_messages(raw_message) -> list[dict[str, object]]:
    payload = json.loads(raw_message)
    if isinstance(payload, list):
        return [message for message in payload if isinstance(message, dict)]
    if isinstance(payload, dict):
        return [payload]
    return []


def _bootstrap_latest_data(
    session_factory,
    *,
    settings: MarketDataWorkerSettings,
    feed: str,
    symbols: list[str],
    data_source: str = "rest_bootstrap",
) -> BootstrapResult:
    result = BootstrapResult(symbols_requested=len(symbols))
    if not symbols:
        return result

    headers = {
        "APCA-API-KEY-ID": settings.alpaca_api_key_id,
        "APCA-API-SECRET-KEY": settings.alpaca_api_secret_key,
        "accept": "application/json",
    }
    params = {"symbols": ",".join(symbols), "feed": feed}
    try:
        with httpx.Client(timeout=20.0) as client:
            quotes_response = client.get(
                f"{ALPACA_REST_BASE_URL}/quotes/latest",
                headers=headers,
                params=params,
            )
            quotes_response.raise_for_status()
            quotes_payload = quotes_response.json()

            bars_response = client.get(
                f"{ALPACA_REST_BASE_URL}/bars/latest",
                headers=headers,
                params=params,
            )
            bars_response.raise_for_status()
            bars_payload = bars_response.json()
    except Exception as exc:
        logger.warning(
            "market-data-worker bootstrap warning provider=%s feed=%s symbols_requested=%s error=%s",
            settings.market_data_provider,
            feed,
            len(symbols),
            _safe_error_message(exc),
        )
        return result

    quote_messages = _latest_payload_messages(quotes_payload, payload_key="quotes", message_type="q")
    bar_messages = _latest_payload_messages(bars_payload, payload_key="bars", message_type="b")
    with session_factory() as db:
        for message in quote_messages:
            _store_market_message(
                db,
                provider=settings.market_data_provider,
                feed=feed,
                message=message,
                data_source=data_source,
            )
        for message in bar_messages:
            _store_market_message(
                db,
                provider=settings.market_data_provider,
                feed=feed,
                message=message,
                data_source=data_source,
            )
    return BootstrapResult(
        symbols_requested=len(symbols),
        quote_symbols_returned=len(quote_messages),
        bar_symbols_returned=len(bar_messages),
        quote_rows_upserted=len(quote_messages),
        candle_rows_upserted=len(bar_messages),
    )


def _latest_payload_messages(
    payload: dict[str, object],
    *,
    payload_key: str,
    message_type: str,
) -> list[dict[str, object]]:
    values = payload.get(payload_key)
    if not isinstance(values, dict):
        return []

    messages: list[dict[str, object]] = []
    for symbol, raw_message in values.items():
        if not isinstance(symbol, str) or not isinstance(raw_message, dict):
            continue
        message = dict(raw_message)
        message["T"] = message_type
        message["S"] = symbol.strip().upper()
        messages.append(message)
    return messages


def _store_market_message(
    db: Session,
    *,
    provider: str,
    feed: str,
    message: dict[str, object],
    data_source: str = "websocket",
) -> str | None:
    stored_message = dict(message)
    stored_message["_data_source"] = data_source
    message_type = message.get("T")
    if message_type == "q":
        stored = _upsert_quote(db, provider=provider, feed=feed, message=stored_message)
    elif message_type == "b":
        stored = _upsert_candle(db, provider=provider, feed=feed, message=stored_message)
    else:
        stored = None
    db.commit()
    return stored


def _upsert_quote(db: Session, *, provider: str, feed: str, message: dict[str, object]) -> str | None:
    symbol = _message_symbol(message)
    if not symbol:
        return None
    quote = _get_quote(db, symbol=symbol, provider=provider, feed=feed)
    source_timestamp = _parse_timestamp(message.get("t"))
    if (
        quote is not None
        and quote.source_timestamp is not None
        and source_timestamp is not None
        and _as_utc(source_timestamp) < _as_utc(quote.source_timestamp)
    ):
        return None
    if quote is None:
        quote = MarketQuote(symbol=symbol, provider=provider, feed=feed)
        db.add(quote)

    bid_price = _positive_decimal_or_none(message.get("bp"))
    ask_price = _positive_decimal_or_none(message.get("ap"))
    if bid_price is not None:
        quote.bid_price = bid_price
        quote.bid_size = _decimal_or_none(message.get("bs"))
    elif quote.bid_price is not None and quote.bid_price <= 0:
        quote.bid_price = None
        quote.bid_size = None
    if ask_price is not None:
        quote.ask_price = ask_price
        quote.ask_size = _decimal_or_none(message.get("as"))
    elif quote.ask_price is not None and quote.ask_price <= 0:
        quote.ask_price = None
        quote.ask_size = None
    quote.source_timestamp = source_timestamp
    quote.updated_at = utc_now()
    quote.raw_payload = message
    return "quote"


def _upsert_yahoo_quote(db: Session, quote_data: YahooQuote) -> bool:
    quote = _get_quote(db, symbol=quote_data.symbol, provider="yahoo", feed="yahoo")
    if (
        quote is not None
        and quote.source_timestamp is not None
        and _as_utc(quote_data.source_timestamp) < _as_utc(quote.source_timestamp)
    ):
        return False
    if quote is None:
        quote = MarketQuote(symbol=quote_data.symbol, provider="yahoo", feed="yahoo")
        db.add(quote)
    quote.last_price = quote_data.last_price
    quote.bid_price = quote_data.bid_price
    quote.ask_price = quote_data.ask_price
    quote.last_bar_close = quote_data.last_price
    quote.source_timestamp = quote_data.source_timestamp
    quote.updated_at = utc_now()
    raw_payload = dict(quote_data.raw_payload)
    raw_payload["_data_source"] = quote_data.data_source
    quote.raw_payload = raw_payload
    return True


def _upsert_yahoo_candle(db: Session, candle_data: YahooCandle) -> bool:
    candle = db.scalar(
        select(MarketCandle)
        .where(MarketCandle.symbol == candle_data.symbol)
        .where(MarketCandle.provider == "yahoo")
        .where(MarketCandle.feed == "yahoo")
        .where(MarketCandle.timeframe == "1m")
        .where(MarketCandle.timestamp == candle_data.timestamp)
    )
    if candle is None:
        candle = MarketCandle(
            symbol=candle_data.symbol,
            provider="yahoo",
            feed="yahoo",
            timeframe="1m",
            timestamp=candle_data.timestamp,
        )
        db.add(candle)
    candle.open = candle_data.open
    candle.high = candle_data.high
    candle.low = candle_data.low
    candle.close = candle_data.close
    candle.volume = candle_data.volume
    candle.raw_payload = candle_data.raw_payload
    candle.updated_at = utc_now()
    return True


def _upsert_candle(db: Session, *, provider: str, feed: str, message: dict[str, object]) -> str | None:
    symbol = _message_symbol(message)
    timestamp = _parse_timestamp(message.get("t"))
    if not symbol or timestamp is None:
        return None
    candle = db.scalar(
        select(MarketCandle)
        .where(MarketCandle.symbol == symbol)
        .where(MarketCandle.provider == provider)
        .where(MarketCandle.feed == feed)
        .where(MarketCandle.timeframe == "1m")
        .where(MarketCandle.timestamp == timestamp)
    )
    if candle is None:
        candle = MarketCandle(
            symbol=symbol,
            provider=provider,
            feed=feed,
            timeframe="1m",
            timestamp=timestamp,
        )
        db.add(candle)

    candle.open = _decimal_or_none(message.get("o"))
    candle.high = _decimal_or_none(message.get("h"))
    candle.low = _decimal_or_none(message.get("l"))
    candle.close = _decimal_or_none(message.get("c"))
    candle.volume = _decimal_or_none(message.get("v"))
    candle.vwap = _decimal_or_none(message.get("vw"))
    candle.trade_count = _int_or_none(message.get("n"))
    candle.raw_payload = message
    candle.updated_at = utc_now()

    quote = _get_quote(db, symbol=symbol, provider=provider, feed=feed)
    if quote is None:
        quote = MarketQuote(symbol=symbol, provider=provider, feed=feed)
        db.add(quote)
    quote.last_bar_close = candle.close
    quote.last_price = candle.close
    quote.source_timestamp = timestamp
    quote.updated_at = utc_now()
    return "candle"


def _touch_provider_status(
    db: Session,
    *,
    provider: str,
    feed: str,
    symbols: list[str],
    message_count: int,
) -> None:
    status = db.scalar(
        select(MarketProviderStatus)
        .where(MarketProviderStatus.provider == provider)
        .where(MarketProviderStatus.feed == feed)
    )
    if status is None:
        status = MarketProviderStatus(provider=provider, feed=feed, status="connected_receiving")
        db.add(status)
    now = utc_now()
    status.status = "connected_receiving"
    status.last_message_at = now
    status.message_count = message_count
    status.subscribed_symbols = symbols
    status.subscribed_count = len(symbols)
    status.error_message = None
    status.updated_at = now
    db.commit()


def _get_quote(db: Session, *, symbol: str, provider: str, feed: str) -> MarketQuote | None:
    return db.scalar(
        select(MarketQuote)
        .where(MarketQuote.symbol == symbol)
        .where(MarketQuote.provider == provider)
        .where(MarketQuote.feed == feed)
    )


def _message_symbol(message: dict[str, object]) -> str:
    value = message.get("S")
    return value.strip().upper() if isinstance(value, str) else ""


def _parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.removesuffix("Z")
    if "." in normalized:
        prefix, suffix = normalized.split(".", 1)
        normalized = f"{prefix}.{suffix[:6]}"
    try:
        return datetime.fromisoformat(normalized).replace(tzinfo=UTC)
    except ValueError:
        return None


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _decimal_or_none(value: object) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _positive_decimal_or_none(value: object) -> Decimal | None:
    number = _decimal_or_none(value)
    if number is None or number <= 0:
        return None
    return number


def _int_or_none(value: object) -> int | None:
    return int(value) if value is not None else None


def _control_error_message(message: dict[str, object]) -> str:
    code = message.get("code", "unknown")
    msg = message.get("msg", "unknown error")
    return f"Alpaca stream error {code}: {msg}"


def _safe_error_message(exc: Exception) -> str:
    message = str(exc)
    key = os.getenv("ALPACA_API_KEY_ID", "")
    secret = os.getenv("ALPACA_API_SECRET_KEY", "")
    if key:
        message = message.replace(key, "[REDACTED]")
    if secret:
        message = message.replace(secret, "[REDACTED]")
    return message


def _log_db_counts(session_factory, *, provider: str, feed: str) -> None:
    with session_factory() as db:
        quote_count = db.scalar(
            select(func.count())
            .select_from(MarketQuote)
            .where(MarketQuote.provider == provider)
            .where(MarketQuote.feed == feed)
        )
        candle_count = db.scalar(
            select(func.count())
            .select_from(MarketCandle)
            .where(MarketCandle.provider == provider)
            .where(MarketCandle.feed == feed)
        )
    logger.info(
        "market-data-worker db counts provider=%s feed=%s market_quotes=%s market_candles=%s",
        provider,
        feed,
        quote_count,
        candle_count,
    )


def run_cleanup_once(settings: MarketDataWorkerSettings) -> MarketDataCleanupResult:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL must be set before running market-data-worker cleanup")
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    try:
        with session_factory() as db:
            return cleanup_market_data(
                db,
                retention_minutes=settings.market_data_retention_minutes,
                status_retention_days=settings.market_data_status_retention_days,
            )
    finally:
        engine.dispose()


async def _run_cleanup_loop(session_factory, *, settings: MarketDataWorkerSettings) -> None:
    interval_seconds = max(1, settings.market_data_cleanup_interval_seconds)
    while True:
        try:
            with session_factory() as db:
                result = cleanup_market_data(
                    db,
                    retention_minutes=settings.market_data_retention_minutes,
                    status_retention_days=settings.market_data_status_retention_days,
                )
            logger.info(
                "market-data-worker cleanup result retention_minutes=%s status_retention_days=%s deleted_candles=%s deleted_quotes=%s deleted_provider_status=%s candle_cutoff=%s",
                result.retention_minutes,
                result.status_retention_days,
                result.deleted_candles,
                result.deleted_quotes,
                result.deleted_provider_status,
                result.candle_cutoff,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("market-data-worker cleanup warning error=%s", _safe_error_message(exc))
        await asyncio.sleep(interval_seconds)


def run_db_diagnostics(settings: MarketDataWorkerSettings, *, symbols: list[str] | None = None) -> dict[str, object]:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL must be set before running market-data-worker diagnostics")
    selected_symbols = symbols or ["AAPL", "NVDA", "TSLA", "LITE"]
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    try:
        with session_factory() as db:
            plan = MarketDataSubscriptionService().get_subscription_symbols(
                db,
                max_symbols=settings.alpaca_max_symbols,
            )
            statuses = list(
                db.scalars(
                    select(MarketProviderStatus).order_by(
                        MarketProviderStatus.updated_at.desc(),
                        MarketProviderStatus.provider.asc(),
                        MarketProviderStatus.feed.asc(),
                    )
                ).all()
            )
            quotes = list(
                db.scalars(
                    select(MarketQuote)
                    .where(MarketQuote.symbol.in_(selected_symbols))
                    .order_by(MarketQuote.symbol.asc(), MarketQuote.updated_at.desc())
                ).all()
            )
            candles_by_symbol: dict[str, list[dict[str, object]]] = {}
            for symbol in selected_symbols:
                candles = list(
                    db.scalars(
                        select(MarketCandle)
                        .where(MarketCandle.symbol == symbol)
                        .order_by(MarketCandle.timestamp.desc(), MarketCandle.provider.asc(), MarketCandle.feed.asc())
                        .limit(10)
                    ).all()
                )
                candles_by_symbol[symbol] = [_candle_diagnostic(row) for row in candles]

        return {
            "selected_feed_if_auto_now": resolve_alpaca_feed(settings.alpaca_feed_mode),
            "new_york_time": datetime.now(NEW_YORK_TZ).isoformat(),
            "subscription_pool": plan.to_dict(),
            "provider_status": [_status_diagnostic(row) for row in statuses],
            "quotes": [_quote_diagnostic(row) for row in quotes],
            "candles_recent_10": candles_by_symbol,
        }
    finally:
        engine.dispose()


def _status_diagnostic(row: MarketProviderStatus) -> dict[str, object]:
    return {
        "provider": row.provider,
        "feed": row.feed,
        "status": row.status,
        "connected_at": _json_value(row.connected_at),
        "disconnected_at": _json_value(row.disconnected_at),
        "last_message_at": _json_value(row.last_message_at),
        "message_count": row.message_count,
        "subscribed_symbols": row.subscribed_symbols,
        "subscribed_count": row.subscribed_count,
        "error_message": row.error_message,
        "updated_at": _json_value(row.updated_at),
    }


def _quote_diagnostic(row: MarketQuote) -> dict[str, object]:
    return {
        "symbol": row.symbol,
        "provider": row.provider,
        "feed": row.feed,
        "last_price": _json_value(row.last_price),
        "bid_price": _json_value(row.bid_price),
        "ask_price": _json_value(row.ask_price),
        "last_bar_close": _json_value(row.last_bar_close),
        "source_timestamp": _json_value(row.source_timestamp),
        "updated_at": _json_value(row.updated_at),
    }


def _candle_diagnostic(row: MarketCandle) -> dict[str, object]:
    return {
        "symbol": row.symbol,
        "provider": row.provider,
        "feed": row.feed,
        "timeframe": row.timeframe,
        "timestamp": _json_value(row.timestamp),
        "open": _json_value(row.open),
        "high": _json_value(row.high),
        "low": _json_value(row.low),
        "close": _json_value(row.close),
        "volume": _json_value(row.volume),
        "vwap": _json_value(row.vwap),
    }


def _json_value(value: object) -> object:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the market data worker.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Plan subscriptions and update provider status without connecting to Alpaca.",
    )
    parser.add_argument(
        "--max-messages",
        type=int,
        default=None,
        help="Stop after processing this many quote/bar messages. Intended for smoke tests.",
    )
    parser.add_argument(
        "--feed",
        choices=["auto", "iex", "overnight"],
        default=None,
        help="Override ALPACA_FEED_MODE for this run.",
    )
    parser.add_argument(
        "--test-stream",
        action="store_true",
        help="Use Alpaca test stream and subscribe only to FAKEPACA. Intended for parser/DB diagnostics.",
    )
    parser.add_argument(
        "--diagnose-db",
        action="store_true",
        help="Print market data DB diagnostics and exit without connecting to Alpaca.",
    )
    parser.add_argument(
        "--cleanup-once",
        action="store_true",
        help="Run market data retention cleanup once and exit without connecting to Alpaca.",
    )
    parser.add_argument(
        "--max-runtime-seconds",
        type=int,
        default=None,
        help="Stop after this many seconds even if no quote/bar messages arrive.",
    )
    parser.add_argument(
        "--log-messages",
        default="false",
        choices=["true", "false"],
        help="Log live message type and symbol only; never logs payloads or secrets.",
    )
    parser.add_argument(
        "--print-db-counts",
        action="store_true",
        help="Log market_quotes and market_candles row counts for the selected feed before exit.",
    )
    args = parser.parse_args()
    settings = load_worker_settings()
    if args.feed is not None:
        settings = replace(settings, alpaca_feed_mode=args.feed)
    configure_logging(settings.log_level)

    if args.diagnose_db:
        print(json.dumps(run_db_diagnostics(settings), indent=2, sort_keys=True))
        return

    if args.cleanup_once:
        result = run_cleanup_once(settings)
        logger.info(
            "market-data-worker cleanup-once retention_minutes=%s status_retention_days=%s deleted_candles=%s deleted_quotes=%s deleted_provider_status=%s candle_cutoff=%s",
            result.retention_minutes,
            result.status_retention_days,
            result.deleted_candles,
            result.deleted_quotes,
            result.deleted_provider_status,
            result.candle_cutoff,
        )
        print(json.dumps(result.to_dict(), sort_keys=True))
        return

    if not args.dry_run:
        asyncio.run(
            run_worker(
                settings,
                max_messages=args.max_messages,
                max_runtime_seconds=args.max_runtime_seconds,
                feed_override=args.feed,
                log_messages=_parse_bool(args.log_messages),
                print_db_counts=args.print_db_counts,
                test_stream=args.test_stream,
            )
        )
        return

    result = run_dry_run(settings)
    logger.info(
        "market-data-worker dry-run provider=%s feed=%s subscribed_count=%s max_symbols=%s overflow_count=%s",
        result["provider"],
        result["feed"],
        result["subscribed_count"],
        result["max_symbols"],
        result["overflow_count"],
    )
    if result["warnings"]:
        logger.warning("market-data-worker dry-run warnings=%s", result["warnings"])
    print(
        "market_data_worker "
        f"status={result['status']} "
        f"provider={result['provider']} "
        f"feed={result['feed']} "
        f"subscribed_count={result['subscribed_count']} "
        f"max_symbols={result['max_symbols']} "
        f"overflow_count={result['overflow_count']}"
    )


if __name__ == "__main__":
    main()
