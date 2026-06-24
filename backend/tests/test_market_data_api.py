import unittest
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.api.market import get_market_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models import MarketCandle, MarketProviderStatus, MarketQuote
from app.models.market_data import utc_now


def make_settings(alpaca_feed_mode: str = "auto") -> Settings:
    return Settings(
        app_name="market-data-api-test",
        app_version="test",
        log_level="INFO",
        cors_origins=[],
        database_url="sqlite://",
        raw_xml_dir="/tmp",
        app_timezone="UTC",
        ibkr_token="",
        ibkr_query_id="",
        ibkr_flex_url="",
        ibkr_flex_version="3",
        ibkr_request_timeout_seconds=1.0,
        ibkr_statement_poll_seconds=0.0,
        ibkr_statement_poll_attempts=1,
        sync_cron_hour=0,
        sync_cron_minute=0,
        market_data_provider="alpaca",
        alpaca_feed_mode=alpaca_feed_mode,
        alpaca_max_symbols=30,
    )


class MarketDataApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )
        app = create_app(make_settings())

        def database_override():
            with self.session_factory() as session:
                yield session

        app.dependency_overrides[get_db] = database_override
        app.dependency_overrides[get_market_settings] = lambda: make_settings("iex")
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_market_data_api_returns_empty_without_data(self) -> None:
        self.assertEqual(self.client.get("/api/market/status").json(), [])
        self.assertEqual(self.client.get("/api/market/quotes").json(), [])
        self.assertIsNone(self.client.get("/api/market/quotes/LITE").json())
        self.assertEqual(
            self.client.get("/api/market/candles/LITE?timeframe=1m&range=1d").json(),
            [],
        )

    def test_market_data_api_reads_local_database(self) -> None:
        now = utc_now()
        with self.session_factory() as db:
            db.add(
                MarketProviderStatus(
                    provider="alpaca",
                    feed="iex",
                    status="subscribed_no_messages",
                    message_count=0,
                    subscribed_symbols=["LITE"],
                    subscribed_count=1,
                    updated_at=now,
                )
            )
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="alpaca",
                    feed="iex",
                    last_price=Decimal("75.50"),
                    bid_price=Decimal("75.40"),
                    ask_price=Decimal("75.60"),
                    last_bar_close=Decimal("75.50"),
                    updated_at=now,
                )
            )
            db.add(
                MarketCandle(
                    symbol="LITE",
                    provider="alpaca",
                    feed="iex",
                    timeframe="1m",
                    timestamp=now - timedelta(minutes=5),
                    open=Decimal("75.10"),
                    high=Decimal("75.70"),
                    low=Decimal("75.00"),
                    close=Decimal("75.50"),
                    volume=Decimal("1200"),
                    vwap=Decimal("75.30"),
                )
            )
            db.commit()

        status = self.client.get("/api/market/status")
        quotes = self.client.get("/api/market/quotes")
        quote = self.client.get("/api/market/quotes/lite")
        candles = self.client.get("/api/market/candles/lite?timeframe=1m&range=1d")

        self.assertEqual(status.status_code, 200)
        self.assertEqual(quotes.status_code, 200)
        self.assertEqual(quote.status_code, 200)
        self.assertEqual(candles.status_code, 200)
        self.assertEqual(status.json()[0]["status"], "subscribed_no_messages")
        self.assertEqual(quotes.json()[0]["symbol"], "LITE")
        self.assertEqual(quote.json()["symbol"], "LITE")
        self.assertEqual(candles.json()[0]["timeframe"], "1m")
        self.assertEqual(candles.json()[0]["provider"], "alpaca")

    def test_market_quote_prefers_newer_source_timestamp_over_local_write_time(self) -> None:
        now = utc_now()
        with self.session_factory() as db:
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="alpaca",
                    feed="iex",
                    last_price=Decimal("895.55"),
                    bid_price=Decimal("849.58"),
                    ask_price=Decimal("907.56"),
                    last_bar_close=Decimal("895.55"),
                    source_timestamp=now - timedelta(hours=12),
                    updated_at=now,
                )
            )
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="alpaca",
                    feed="overnight",
                    last_price=Decimal("905.98"),
                    last_bar_close=Decimal("905.98"),
                    source_timestamp=now - timedelta(minutes=30),
                    updated_at=now - timedelta(hours=1),
                )
            )
            db.commit()

        quote = self.client.get("/api/market/quotes/LITE")

        self.assertEqual(quote.status_code, 200)
        self.assertEqual(quote.json()["feed"], "overnight")
        self.assertEqual(quote.json()["last_price"], "905.98000000")
        self.assertEqual(quote.json()["active_feed"], "iex")
        self.assertEqual(quote.json()["data_source"], "latest_available")
        self.assertTrue(quote.json()["is_stale"])

    def test_market_quote_returns_active_feed_when_recent(self) -> None:
        now = utc_now()
        with self.session_factory() as db:
            db.add(
                MarketProviderStatus(
                    provider="alpaca",
                    feed="iex",
                    status="connected_receiving",
                    message_count=10,
                    subscribed_symbols=["LITE"],
                    subscribed_count=1,
                    last_message_at=now,
                    updated_at=now,
                )
            )
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="alpaca",
                    feed="iex",
                    last_price=Decimal("75.50"),
                    source_timestamp=now,
                    updated_at=now,
                    raw_payload={"_data_source": "websocket"},
                )
            )
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="alpaca",
                    feed="overnight",
                    last_price=Decimal("74.00"),
                    source_timestamp=now - timedelta(hours=2),
                    updated_at=now - timedelta(hours=2),
                    raw_payload={"_data_source": "websocket"},
                )
            )
            db.commit()

        quote = self.client.get("/api/market/quotes/LITE")

        self.assertEqual(quote.status_code, 200)
        self.assertEqual(quote.json()["feed"], "iex")
        self.assertEqual(quote.json()["active_feed"], "iex")
        self.assertEqual(quote.json()["data_source"], "websocket")
        self.assertEqual(quote.json()["status_label"], "realtime")
        self.assertFalse(quote.json()["is_stale"])

    def test_market_quote_returns_yahoo_fallback_when_alpaca_active_feed_is_stale(self) -> None:
        now = utc_now()
        with self.session_factory() as db:
            db.add(
                MarketProviderStatus(
                    provider="alpaca",
                    feed="iex",
                    status="subscribed_no_messages",
                    message_count=0,
                    subscribed_symbols=["LITE"],
                    subscribed_count=1,
                    updated_at=now,
                )
            )
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="alpaca",
                    feed="iex",
                    last_price=Decimal("75.50"),
                    source_timestamp=now - timedelta(hours=1),
                    updated_at=now,
                    raw_payload={"_data_source": "rest_fallback"},
                )
            )
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="yahoo",
                    feed="yahoo",
                    last_price=Decimal("76.25"),
                    source_timestamp=now,
                    updated_at=now,
                    raw_payload={"_data_source": "yahoo_poll"},
                )
            )
            db.commit()

        quote = self.client.get("/api/market/quotes/LITE")

        self.assertEqual(quote.status_code, 200)
        self.assertEqual(quote.json()["provider"], "yahoo")
        self.assertEqual(quote.json()["feed"], "yahoo")
        self.assertEqual(quote.json()["active_provider"], "alpaca")
        self.assertEqual(quote.json()["status_label"], "fallback")
        self.assertEqual(quote.json()["data_source"], "yahoo_poll")
        self.assertFalse(quote.json()["is_stale"])

    def test_market_quote_prefers_yahoo_when_yahoo_is_active(self) -> None:
        import app.api.market as market_api

        now = utc_now()
        original = market_api.resolve_market_data_route
        try:
            market_api.resolve_market_data_route = lambda _mode: type(
                "Route",
                (),
                {
                    "active_provider": "yahoo",
                    "active_feed": "yahoo",
                    "reason": "test yahoo gap",
                },
            )()
            with self.session_factory() as db:
                db.add(
                    MarketProviderStatus(
                        provider="yahoo",
                        feed="yahoo",
                        status="polling",
                        message_count=1,
                        subscribed_symbols=["LITE"],
                        subscribed_count=1,
                        updated_at=now,
                    )
                )
                db.add(
                    MarketQuote(
                        symbol="LITE",
                        provider="yahoo",
                        feed="yahoo",
                        last_price=Decimal("76.25"),
                        source_timestamp=now,
                        updated_at=now,
                        raw_payload={"_data_source": "yahoo_poll"},
                    )
                )
                db.add(
                    MarketQuote(
                        symbol="LITE",
                        provider="alpaca",
                        feed="overnight",
                        last_price=Decimal("75.00"),
                        source_timestamp=now,
                        updated_at=now,
                        raw_payload={"_data_source": "websocket"},
                    )
                )
                db.commit()

            quote = self.client.get("/api/market/quotes/LITE")
        finally:
            market_api.resolve_market_data_route = original

        self.assertEqual(quote.status_code, 200)
        self.assertEqual(quote.json()["provider"], "yahoo")
        self.assertEqual(quote.json()["active_provider"], "yahoo")
        self.assertEqual(quote.json()["status_label"], "fallback")
        self.assertFalse(quote.json()["is_stale"])

    def test_market_quote_returns_overnight_when_overnight_is_active(self) -> None:
        self.client.app.dependency_overrides[get_market_settings] = lambda: make_settings("overnight")
        now = utc_now()
        with self.session_factory() as db:
            db.add(
                MarketProviderStatus(
                    provider="alpaca",
                    feed="overnight",
                    status="connected_receiving",
                    message_count=10,
                    subscribed_symbols=["LITE"],
                    subscribed_count=1,
                    last_message_at=now,
                    updated_at=now,
                )
            )
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="alpaca",
                    feed="overnight",
                    last_price=Decimal("905.98"),
                    source_timestamp=now,
                    updated_at=now,
                    raw_payload={"_data_source": "websocket"},
                )
            )
            db.commit()

        quote = self.client.get("/api/market/quotes/LITE")

        self.assertEqual(quote.status_code, 200)
        self.assertEqual(quote.json()["feed"], "overnight")
        self.assertEqual(quote.json()["active_feed"], "overnight")
        self.assertEqual(quote.json()["status_label"], "realtime")

    def test_old_bootstrap_quote_does_not_override_new_live_quote(self) -> None:
        now = utc_now()
        with self.session_factory() as db:
            db.add(
                MarketProviderStatus(
                    provider="alpaca",
                    feed="iex",
                    status="connected_receiving",
                    message_count=10,
                    subscribed_symbols=["LITE"],
                    subscribed_count=1,
                    last_message_at=now,
                    updated_at=now,
                )
            )
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="alpaca",
                    feed="iex",
                    last_price=Decimal("75.50"),
                    source_timestamp=now,
                    updated_at=now - timedelta(minutes=1),
                    raw_payload={"_data_source": "websocket"},
                )
            )
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="alpaca",
                    feed="overnight",
                    last_price=Decimal("80.00"),
                    source_timestamp=now - timedelta(hours=12),
                    updated_at=now + timedelta(minutes=1),
                    raw_payload={"_data_source": "rest_bootstrap"},
                )
            )
            db.commit()

        quote = self.client.get("/api/market/quotes/LITE")

        self.assertEqual(quote.status_code, 200)
        self.assertEqual(quote.json()["feed"], "iex")
        self.assertEqual(quote.json()["last_price"], "75.50000000")

    def test_market_quote_merges_bid_ask_from_freshest_row_when_selected_has_none(self) -> None:
        now = utc_now()
        bid_ask_time = now - timedelta(minutes=40)
        with self.session_factory() as db:
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="alpaca",
                    feed="iex",
                    last_price=Decimal("75.50"),
                    bid_price=Decimal("75.40"),
                    ask_price=Decimal("75.60"),
                    source_timestamp=bid_ask_time,
                    updated_at=now,
                    raw_payload={
                        "_data_source": "websocket",
                        "_bid_ask_timestamp": bid_ask_time.isoformat(),
                    },
                )
            )
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="yahoo",
                    feed="yahoo",
                    last_price=Decimal("76.25"),
                    source_timestamp=now,
                    updated_at=now,
                    raw_payload={"_data_source": "yahoo_poll"},
                )
            )
            db.commit()

        quote = self.client.get("/api/market/quotes/LITE")

        self.assertEqual(quote.status_code, 200)
        payload = quote.json()
        self.assertEqual(payload["provider"], "yahoo")
        self.assertEqual(payload["bid_price"], "75.40000000")
        self.assertEqual(payload["ask_price"], "75.60000000")
        self.assertEqual(payload["bid_ask_provider"], "alpaca")
        self.assertEqual(payload["bid_ask_feed"], "iex")
        self.assertIsNotNone(payload["bid_ask_timestamp"])
        self.assertGreaterEqual(payload["bid_ask_stale_seconds"], 2300)

    def test_market_candles_dedupes_same_minute_across_providers(self) -> None:
        now = utc_now()
        minute = now - timedelta(minutes=5)
        with self.session_factory() as db:
            db.add(
                MarketCandle(
                    symbol="LITE",
                    provider="yahoo",
                    feed="yahoo",
                    timeframe="1m",
                    timestamp=minute,
                    open=Decimal("75.00"),
                    high=Decimal("75.20"),
                    low=Decimal("74.90"),
                    close=Decimal("75.10"),
                    volume=Decimal("800"),
                )
            )
            db.add(
                MarketCandle(
                    symbol="LITE",
                    provider="alpaca",
                    feed="iex",
                    timeframe="1m",
                    timestamp=minute,
                    open=Decimal("75.01"),
                    high=Decimal("75.21"),
                    low=Decimal("74.91"),
                    close=Decimal("75.11"),
                    volume=Decimal("900"),
                )
            )
            db.add(
                MarketCandle(
                    symbol="LITE",
                    provider="yahoo",
                    feed="yahoo",
                    timeframe="1m",
                    timestamp=minute + timedelta(minutes=1),
                    open=Decimal("75.11"),
                    high=Decimal("75.30"),
                    low=Decimal("75.05"),
                    close=Decimal("75.25"),
                    volume=Decimal("500"),
                )
            )
            db.commit()

        response = self.client.get("/api/market/candles/LITE?timeframe=1m&range=1d")

        self.assertEqual(response.status_code, 200)
        rows = response.json()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["provider"], "alpaca")
        self.assertEqual(rows[1]["provider"], "yahoo")

    def test_market_candles_rejects_unknown_range(self) -> None:
        response = self.client.get("/api/market/candles/LITE?range=bad")

        self.assertEqual(response.status_code, 400)

    def test_market_candles_falls_back_to_last_session_when_window_empty(self) -> None:
        # Markets closed (weekend/holiday): the only stored candles are days old,
        # so a fresh "last 1h" window is empty. The endpoint should fall back to
        # the most recent stored window instead of returning nothing.
        stale = utc_now() - timedelta(days=3)
        with self.session_factory() as db:
            for offset in range(3):
                db.add(
                    MarketCandle(
                        symbol="LITE",
                        provider="alpaca",
                        feed="overnight",
                        timeframe="1m",
                        timestamp=stale + timedelta(minutes=offset),
                        open=Decimal("80.00"),
                        high=Decimal("80.20"),
                        low=Decimal("79.90"),
                        close=Decimal("80.10"),
                        volume=Decimal("100"),
                    )
                )
            db.commit()

        response = self.client.get("/api/market/candles/LITE?timeframe=1m&range=1h")

        self.assertEqual(response.status_code, 200)
        rows = response.json()
        self.assertEqual(len(rows), 3)
        self.assertEqual(Decimal(rows[-1]["close"]), Decimal("80.10"))

    def test_batch_quotes_selects_active_provider_per_symbol(self) -> None:
        now = utc_now()
        with self.session_factory() as db:
            # Fresh active-feed (alpaca/iex) quote plus a stale Yahoo fallback
            # for the same symbol. The batch endpoint must return ONE entry that
            # reflects the active feed, not the alphabetically-last Yahoo row.
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="alpaca",
                    feed="iex",
                    last_price=Decimal("100.00"),
                    source_timestamp=now,
                    updated_at=now,
                    raw_payload={"_data_source": "websocket", "_previous_close": 90.0},
                )
            )
            db.add(
                MarketQuote(
                    symbol="LITE",
                    provider="yahoo",
                    feed="yahoo",
                    last_price=Decimal("50.00"),
                    source_timestamp=now - timedelta(hours=3),
                    updated_at=now - timedelta(hours=3),
                )
            )
            db.commit()

        rows = self.client.get("/api/market/quotes").json()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["symbol"], "LITE")
        self.assertEqual(rows[0]["last_price"], "100.00000000")
        self.assertEqual(Decimal(rows[0]["previous_close"]), Decimal("90"))

    def test_market_candles_accepts_7d_range(self) -> None:
        now = utc_now()
        with self.session_factory() as db:
            db.add(
                MarketCandle(
                    symbol="LITE",
                    provider="alpaca",
                    feed="iex",
                    timeframe="1m",
                    timestamp=now - timedelta(days=3),
                    open=Decimal("70.00"),
                    high=Decimal("70.50"),
                    low=Decimal("69.50"),
                    close=Decimal("70.25"),
                    volume=Decimal("1000"),
                )
            )
            db.commit()

        response = self.client.get("/api/market/candles/LITE?timeframe=1m&range=7d")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)

    def test_market_candles_downsamples_long_ranges(self) -> None:
        now = utc_now()
        # ~2000 one-minute candles spread across ~33h; the endpoint should
        # bucket them down to at most MAX_CANDLE_POINTS for the chart.
        with self.session_factory() as db:
            for index in range(2000):
                db.add(
                    MarketCandle(
                        symbol="LITE",
                        provider="alpaca",
                        feed="iex",
                        timeframe="1m",
                        timestamp=now - timedelta(minutes=2000 - index),
                        open=Decimal("70.00"),
                        high=Decimal("70.50"),
                        low=Decimal("69.50"),
                        close=Decimal(f"{70 + index * 0.001:.4f}"),
                        volume=Decimal("1000"),
                    )
                )
            db.commit()

        response = self.client.get("/api/market/candles/LITE?timeframe=1m&range=7d")

        self.assertEqual(response.status_code, 200)
        rows = response.json()
        self.assertLessEqual(len(rows), 721)
        self.assertLess(len(rows), 2000)
        # The most recent candle is always preserved (last bucket), and the
        # downsampled series stays sorted ascending by timestamp.
        self.assertEqual(rows[-1]["close"], "71.99900000")
        timestamps = [row["timestamp"] for row in rows]
        self.assertEqual(timestamps, sorted(timestamps))


if __name__ == "__main__":
    unittest.main()
