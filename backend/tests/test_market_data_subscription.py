import tempfile
import unittest
from datetime import UTC, datetime, date
from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.market import get_market_settings
from app.core.config import Settings
from app.core.constants import ALPACA_FREE_MAX_SYMBOLS
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models import LotAnalysisDaily, RawFlexReport, WatchlistTicker
from app.services.market_data_subscription import MarketDataSubscriptionService


def make_settings() -> Settings:
    return Settings(
        app_name="market-data-subscription-test",
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
        alpaca_api_key_id="",
        alpaca_api_secret_key="",
        alpaca_feed_mode="auto",
        alpaca_max_symbols=3,
    )


class MarketDataSubscriptionServiceTest(unittest.TestCase):
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

    def _seed_subscription_candidates(self) -> None:
        with self.session_factory() as db:
            report = RawFlexReport(
                query_id="subscription-test",
                xml_path=str(Path(self.temp_dir.name) / "statement.xml"),
                xml_sha256="subscription-test",
                downloaded_at=datetime(2026, 6, 8, tzinfo=UTC),
                status="parsed",
            )
            db.add(report)
            db.flush()
            db.add_all(
                [
                    LotAnalysisDaily(
                        report_date=date(2026, 6, 8),
                        account_id="TEST",
                        symbol=" aapl ",
                        conid="1",
                        total_quantity=Decimal("2"),
                        raw_flex_report_id=report.id,
                    ),
                    LotAnalysisDaily(
                        report_date=date(2026, 6, 8),
                        account_id="TEST",
                        symbol="msft",
                        conid="2",
                        total_quantity=Decimal("1"),
                        raw_flex_report_id=report.id,
                    ),
                    LotAnalysisDaily(
                        report_date=date(2026, 6, 8),
                        account_id="TEST",
                        symbol="CASH",
                        conid="3",
                        total_quantity=Decimal("0"),
                        raw_flex_report_id=report.id,
                    ),
                    WatchlistTicker(symbol="AAPL", realtime_enabled=True),
                    WatchlistTicker(symbol="nvda", realtime_enabled=True),
                    WatchlistTicker(symbol="tsla", realtime_enabled=True),
                    WatchlistTicker(symbol="lite", realtime_enabled=False),
                ]
            )
            db.commit()

    def test_subscription_pool_prioritizes_holdings_and_dedupes_watchlist(self) -> None:
        self._seed_subscription_candidates()
        with self.session_factory() as db:
            plan = MarketDataSubscriptionService().get_subscription_symbols(
                db,
                max_symbols=3,
            )

        self.assertEqual(plan.symbols, ["AAPL", "MSFT", "NVDA"])
        self.assertEqual(plan.max_symbols, 3)
        self.assertEqual(plan.total_candidates, 4)
        self.assertEqual(plan.subscribed_count, 3)
        self.assertEqual(plan.overflow_count, 1)
        self.assertEqual(plan.holdings_count, 2)
        self.assertEqual(plan.watchlist_realtime_count, 3)
        self.assertEqual(plan.excluded_symbols, ["TSLA"])
        self.assertEqual(
            plan.warnings,
            ["Subscription candidates exceed ALPACA_MAX_SYMBOLS; realtime watchlist symbols were truncated."],
        )

    def test_subscription_pool_warns_when_holdings_exceed_limit(self) -> None:
        self._seed_subscription_candidates()
        with self.session_factory() as db:
            plan = MarketDataSubscriptionService().get_subscription_symbols(
                db,
                max_symbols=1,
            )

        self.assertEqual(plan.symbols, ["AAPL"])
        self.assertEqual(plan.excluded_symbols, ["MSFT", "NVDA", "TSLA"])
        self.assertEqual(plan.overflow_count, 3)
        self.assertEqual(
            plan.warnings,
            ["Current holdings exceed ALPACA_MAX_SYMBOLS; some holding symbols were excluded."],
        )

    def test_default_max_symbols_comes_from_shared_constant(self) -> None:
        self._seed_subscription_candidates()
        with self.session_factory() as db:
            plan = MarketDataSubscriptionService().get_subscription_symbols(db)
        # No max_symbols passed -> falls back to the single source of truth.
        self.assertEqual(plan.max_symbols, ALPACA_FREE_MAX_SYMBOLS)
        self.assertEqual(ALPACA_FREE_MAX_SYMBOLS, 30)
        # Well under the cap, so everything subscribes and nothing is excluded.
        self.assertEqual(plan.overflow_count, 0)
        self.assertEqual(plan.warnings, [])

    def test_preview_api_uses_configured_max_symbols_without_alpaca_credentials(self) -> None:
        self._seed_subscription_candidates()
        app = create_app(make_settings())

        def database_override():
            with self.session_factory() as session:
                yield session

        app.dependency_overrides[get_db] = database_override
        app.dependency_overrides[get_market_settings] = make_settings

        with TestClient(app) as client:
            response = client.get("/api/market/subscriptions/preview")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["symbols"], ["AAPL", "MSFT", "NVDA"])
        self.assertEqual(payload["max_symbols"], 3)
        self.assertEqual(payload["overflow_count"], 1)


if __name__ == "__main__":
    unittest.main()
