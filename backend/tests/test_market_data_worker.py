import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import LotAnalysisDaily, MarketCandle, MarketProviderStatus, MarketQuote, RawFlexReport, WatchlistTicker
from app.services.alpaca_feed import resolve_market_data_route
from app.workers.market_data_worker import (
    MarketDataWorkerSettings,
    _bootstrap_latest_data,
    _latest_payload_messages,
    _store_market_message,
    _touch_provider_status,
    alpaca_stream_url,
    run_cleanup_once,
    resolve_alpaca_feed,
    run_dry_run,
)


class MarketDataWorkerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )

    def tearDown(self) -> None:
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_resolve_alpaca_feed_modes(self) -> None:
        self.assertEqual(resolve_alpaca_feed("iex"), "iex")
        self.assertEqual(resolve_alpaca_feed("overnight"), "overnight")
        self.assertEqual(
            resolve_alpaca_feed("auto", datetime(2026, 6, 8, 3, 59, tzinfo=UTC)),
            "overnight",
        )
        self.assertEqual(
            resolve_alpaca_feed("auto", datetime(2026, 6, 8, 12, 0, tzinfo=UTC)),
            "iex",
        )
        self.assertEqual(alpaca_stream_url("iex"), "wss://stream.data.alpaca.markets/v2/iex")
        self.assertEqual(
            alpaca_stream_url("overnight"),
            "wss://stream.data.alpaca.markets/v1beta1/overnight",
        )
        self.assertEqual(alpaca_stream_url("test"), "wss://stream.data.alpaca.markets/v2/test")

    def test_resolve_alpaca_feed_auto_new_york_boundaries(self) -> None:
        from app.services.alpaca_feed import NEW_YORK_TZ

        self.assertEqual(resolve_alpaca_feed("auto", datetime(2026, 6, 8, 21, 0, tzinfo=NEW_YORK_TZ)), "overnight")
        self.assertEqual(resolve_alpaca_feed("auto", datetime(2026, 6, 8, 3, 59, tzinfo=NEW_YORK_TZ)), "overnight")
        self.assertEqual(resolve_alpaca_feed("auto", datetime(2026, 6, 8, 4, 0, tzinfo=NEW_YORK_TZ)), "iex")
        self.assertEqual(resolve_alpaca_feed("auto", datetime(2026, 6, 8, 10, 0, tzinfo=NEW_YORK_TZ)), "iex")
        self.assertEqual(resolve_alpaca_feed("auto", datetime(2026, 6, 8, 19, 59, tzinfo=NEW_YORK_TZ)), "iex")
        self.assertEqual(resolve_alpaca_feed("auto", datetime(2026, 6, 8, 20, 0, tzinfo=NEW_YORK_TZ)), "overnight")

    def test_resolve_market_data_route_boundaries(self) -> None:
        from app.services.alpaca_feed import NEW_YORK_TZ

        cases = [
            (datetime(2026, 6, 8, 21, 0, tzinfo=NEW_YORK_TZ), "alpaca", "overnight"),
            (datetime(2026, 6, 8, 3, 59, tzinfo=NEW_YORK_TZ), "alpaca", "overnight"),
            (datetime(2026, 6, 8, 4, 0, tzinfo=NEW_YORK_TZ), "yahoo", "yahoo"),
            (datetime(2026, 6, 8, 5, 10, tzinfo=NEW_YORK_TZ), "yahoo", "yahoo"),
            (datetime(2026, 6, 8, 7, 59, tzinfo=NEW_YORK_TZ), "yahoo", "yahoo"),
            (datetime(2026, 6, 8, 8, 0, tzinfo=NEW_YORK_TZ), "alpaca", "iex"),
            (datetime(2026, 6, 8, 10, 0, tzinfo=NEW_YORK_TZ), "alpaca", "iex"),
            (datetime(2026, 6, 8, 16, 59, tzinfo=NEW_YORK_TZ), "alpaca", "iex"),
            (datetime(2026, 6, 8, 17, 0, tzinfo=NEW_YORK_TZ), "yahoo", "yahoo"),
            (datetime(2026, 6, 8, 19, 59, tzinfo=NEW_YORK_TZ), "yahoo", "yahoo"),
            (datetime(2026, 6, 8, 20, 0, tzinfo=NEW_YORK_TZ), "alpaca", "overnight"),
        ]
        for current_time, provider, feed in cases:
            with self.subTest(current_time=current_time):
                route = resolve_market_data_route("auto", current_time)
                self.assertEqual(route.active_provider, provider)
                self.assertEqual(route.active_feed, feed)
                self.assertIsNotNone(route.next_switch_time)

    def test_dry_run_writes_provider_status_without_credentials(self) -> None:
        self._seed_candidates()
        settings = _worker_settings(
            database_url="sqlite://",
            alpaca_api_key_id="",
            alpaca_api_secret_key="",
            alpaca_feed_mode="iex",
            alpaca_max_symbols=2,
        )

        result = run_dry_run_with_session_factory(settings, self.session_factory)

        self.assertEqual(result["symbols"], ["AAPL", "MSFT"])
        self.assertEqual(result["provider"], "alpaca")
        self.assertEqual(result["feed"], "iex")
        self.assertEqual(result["status"], "dry_run")
        with self.session_factory() as db:
            status = db.scalar(
                select(MarketProviderStatus)
                .where(MarketProviderStatus.provider == "alpaca")
                .where(MarketProviderStatus.feed == "iex")
            )
            self.assertIsNotNone(status)
            self.assertEqual(status.status, "dry_run")
            self.assertEqual(status.subscribed_symbols, ["AAPL", "MSFT"])
            self.assertEqual(status.subscribed_count, 2)
            self.assertIsNone(status.last_message_at)
            self.assertIsNone(status.error_message)

    def test_store_quote_and_bar_messages(self) -> None:
        with self.session_factory() as db:
            quote_result = _store_market_message(
                db,
                provider="alpaca",
                feed="iex",
                message={
                    "T": "q",
                    "S": "aapl",
                    "bp": 100.12,
                    "bs": 2,
                    "ap": 100.15,
                    "as": 3,
                    "t": "2026-06-08T14:30:01.123456789Z",
                },
            )
            candle_result = _store_market_message(
                db,
                provider="alpaca",
                feed="iex",
                message={
                    "T": "b",
                    "S": "AAPL",
                    "o": 100,
                    "h": 101,
                    "l": 99,
                    "c": 100.5,
                    "v": 1200,
                    "vw": 100.25,
                    "n": 42,
                    "t": "2026-06-08T14:30:00Z",
                },
            )
            self.assertEqual(quote_result, "quote")
            self.assertEqual(candle_result, "candle")

        with self.session_factory() as db:
            quote = db.scalar(select(MarketQuote).where(MarketQuote.symbol == "AAPL"))
            candle = db.scalar(select(MarketCandle).where(MarketCandle.symbol == "AAPL"))
            self.assertIsNotNone(quote)
            self.assertIsNotNone(candle)
            self.assertEqual(quote.bid_size, Decimal("2.00000000"))
            self.assertEqual(quote.last_bar_close, Decimal("100.50000000"))
            self.assertEqual(candle.timeframe, "1m")
            self.assertEqual(candle.trade_count, 42)

    def test_zero_quote_prices_do_not_overwrite_valid_bid_ask(self) -> None:
        with self.session_factory() as db:
            _store_market_message(
                db,
                provider="alpaca",
                feed="overnight",
                message={
                    "T": "q",
                    "S": "LITE",
                    "bp": 901.12,
                    "bs": 2,
                    "ap": 901.18,
                    "as": 3,
                    "t": "2026-06-09T07:59:00Z",
                },
            )
            _store_market_message(
                db,
                provider="alpaca",
                feed="overnight",
                message={
                    "T": "q",
                    "S": "LITE",
                    "bp": 0,
                    "bs": 0,
                    "ap": 0,
                    "as": 0,
                    "t": "2026-06-09T08:00:00Z",
                },
            )

        with self.session_factory() as db:
            quote = db.scalar(select(MarketQuote).where(MarketQuote.symbol == "LITE"))
            self.assertIsNotNone(quote)
            self.assertEqual(quote.bid_price, Decimal("901.12000000"))
            self.assertEqual(quote.ask_price, Decimal("901.18000000"))
            self.assertEqual(quote.bid_size, Decimal("2.00000000"))
            self.assertEqual(quote.ask_size, Decimal("3.00000000"))

    def test_latest_payload_messages_adds_type_and_symbol(self) -> None:
        messages = _latest_payload_messages(
            {"quotes": {"aapl": {"bp": 100, "ap": 101, "t": "2026-06-08T14:30:01Z"}}},
            payload_key="quotes",
            message_type="q",
        )

        self.assertEqual(messages, [{"bp": 100, "ap": 101, "t": "2026-06-08T14:30:01Z", "T": "q", "S": "AAPL"}])

    def test_bootstrap_latest_data_writes_quote_and_bar(self) -> None:
        settings = _worker_settings(
            database_url="sqlite://",
            alpaca_api_key_id="test-key",
            alpaca_api_secret_key="test-secret",
            alpaca_feed_mode="iex",
            alpaca_max_symbols=2,
        )

        from app.workers import market_data_worker

        original_client = market_data_worker.httpx.Client
        try:
            market_data_worker.httpx.Client = lambda *_, **__: FakeHttpClient()
            result = _bootstrap_latest_data(
                self.session_factory,
                settings=settings,
                feed="iex",
                symbols=["AAPL", "NVDA"],
            )
        finally:
            market_data_worker.httpx.Client = original_client

        self.assertEqual(result.symbols_requested, 2)
        self.assertEqual(result.quote_rows_upserted, 1)
        self.assertEqual(result.candle_rows_upserted, 1)
        with self.session_factory() as db:
            quote = db.scalar(select(MarketQuote).where(MarketQuote.symbol == "AAPL"))
            candle = db.scalar(select(MarketCandle).where(MarketCandle.symbol == "AAPL"))
            self.assertIsNotNone(quote)
            self.assertIsNotNone(candle)
            self.assertEqual(quote.bid_price, Decimal("100.12000000"))
            self.assertEqual(quote.last_price, Decimal("100.50000000"))
            self.assertEqual(candle.close, Decimal("100.50000000"))

    def test_touch_provider_status_marks_connected_receiving(self) -> None:
        with self.session_factory() as db:
            _touch_provider_status(
                db,
                provider="alpaca",
                feed="iex",
                symbols=["AAPL"],
                message_count=1,
            )

        with self.session_factory() as db:
            status = db.scalar(select(MarketProviderStatus).where(MarketProviderStatus.provider == "alpaca"))
            self.assertIsNotNone(status)
            self.assertEqual(status.status, "connected_receiving")
            self.assertEqual(status.message_count, 1)

    def test_cleanup_once_deletes_old_candles_but_keeps_quote_and_status_snapshots(self) -> None:
        old_timestamp = datetime.now(UTC) - timedelta(hours=3)
        recent_timestamp = datetime.now(UTC) - timedelta(minutes=10)
        with self.session_factory() as db:
            db.add_all(
                [
                    MarketCandle(
                        symbol="LITE",
                        provider="yahoo",
                        feed="yahoo",
                        timeframe="1m",
                        timestamp=old_timestamp,
                        close=Decimal("100"),
                    ),
                    MarketCandle(
                        symbol="LITE",
                        provider="yahoo",
                        feed="yahoo",
                        timeframe="1m",
                        timestamp=recent_timestamp,
                        close=Decimal("101"),
                    ),
                    MarketQuote(
                        symbol="LITE",
                        provider="yahoo",
                        feed="yahoo",
                        last_price=Decimal("101"),
                        source_timestamp=old_timestamp,
                    ),
                    MarketProviderStatus(provider="yahoo", feed="yahoo", status="polling"),
                ]
            )
            db.commit()

        settings = _worker_settings(database_url="sqlite://", market_data_retention_minutes=60)
        result = run_cleanup_once_with_session_factory(settings, self.session_factory)

        self.assertEqual(result.deleted_candles, 1)
        self.assertEqual(result.deleted_quotes, 0)
        self.assertEqual(result.deleted_provider_status, 0)
        with self.session_factory() as db:
            candles = list(db.scalars(select(MarketCandle).order_by(MarketCandle.timestamp)).all())
            quote_count = db.scalar(select(func.count()).select_from(MarketQuote))
            status_count = db.scalar(select(func.count()).select_from(MarketProviderStatus))
            self.assertEqual(len(candles), 1)
            self.assertEqual(candles[0].close, Decimal("101.00000000"))
            self.assertEqual(quote_count, 1)
            self.assertEqual(status_count, 1)

    def _seed_candidates(self) -> None:
        with self.session_factory() as db:
            report = RawFlexReport(
                query_id="worker-test",
                xml_path=str(Path(self.temp_dir.name) / "statement.xml"),
                xml_sha256="worker-test",
                downloaded_at=datetime(2026, 6, 8, tzinfo=UTC),
                status="parsed",
            )
            db.add(report)
            db.flush()
            db.add_all(
                [
                    LotAnalysisDaily(
                        report_date=datetime(2026, 6, 8, tzinfo=UTC).date(),
                        account_id="TEST",
                        symbol="AAPL",
                        conid="1",
                        total_quantity=Decimal("1"),
                        raw_flex_report_id=report.id,
                    ),
                    WatchlistTicker(symbol="MSFT", realtime_enabled=True),
                ]
            )
            db.commit()


class FakeHttpResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeHttpClient:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def get(self, url, **_):
        if url.endswith("/quotes/latest"):
            return FakeHttpResponse(
                {
                    "quotes": {
                        "AAPL": {
                            "bp": 100.12,
                            "bs": 2,
                            "ap": 100.15,
                            "as": 3,
                            "t": "2026-06-08T14:30:01Z",
                        }
                    }
                }
            )
        return FakeHttpResponse(
            {
                "bars": {
                    "AAPL": {
                        "o": 100,
                        "h": 101,
                        "l": 99,
                        "c": 100.5,
                        "v": 1200,
                        "vw": 100.25,
                        "n": 42,
                        "t": "2026-06-08T14:30:00Z",
                    }
                }
            }
        )


def run_dry_run_with_session_factory(settings, session_factory):
    from app.workers import market_data_worker

    original_create_engine = market_data_worker.create_engine
    original_sessionmaker = market_data_worker.sessionmaker

    class EngineStub:
        def dispose(self):
            pass

    try:
        market_data_worker.create_engine = lambda *_, **__: EngineStub()
        market_data_worker.sessionmaker = lambda *_, **__: session_factory
        return run_dry_run(settings)
    finally:
        market_data_worker.create_engine = original_create_engine
        market_data_worker.sessionmaker = original_sessionmaker


def run_cleanup_once_with_session_factory(settings, session_factory):
    from app.workers import market_data_worker

    original_create_engine = market_data_worker.create_engine
    original_sessionmaker = market_data_worker.sessionmaker

    class EngineStub:
        def dispose(self):
            pass

    try:
        market_data_worker.create_engine = lambda *_, **__: EngineStub()
        market_data_worker.sessionmaker = lambda *_, **__: session_factory
        return run_cleanup_once(settings)
    finally:
        market_data_worker.create_engine = original_create_engine
        market_data_worker.sessionmaker = original_sessionmaker


def _worker_settings(**overrides):
    values = {
        "database_url": "sqlite://",
        "log_level": "INFO",
        "market_data_provider": "alpaca",
        "alpaca_api_key_id": "test-key",
        "alpaca_api_secret_key": "test-secret",
        "alpaca_feed_mode": "auto",
        "alpaca_max_symbols": 30,
        "yahoo_fallback_enabled": True,
        "yahoo_fallback_mode": "auto",
        "yahoo_fallback_interval_seconds": 15,
        "yahoo_fallback_max_symbols": 30,
        "yahoo_fallback_write_candles": True,
        "yahoo_fallback_timeout_seconds": 10,
        "market_data_retention_minutes": 60,
        "market_data_cleanup_interval_seconds": 300,
        "market_data_status_retention_days": 7,
    }
    values.update(overrides)
    return MarketDataWorkerSettings(**values)


if __name__ == "__main__":
    unittest.main()
