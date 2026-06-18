import tempfile
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models import UsSymbol


def make_settings() -> Settings:
    return Settings(
        app_name="symbols-api-test",
        app_version="test",
        log_level="INFO",
        cors_origins=[],
        database_url="sqlite://",
        raw_xml_dir=tempfile.gettempdir(),
        app_timezone="UTC",
        ibkr_token="unused",
        ibkr_query_id="unused",
        ibkr_flex_url="https://example.invalid/flex",
        ibkr_flex_version="3",
        ibkr_request_timeout_seconds=1.0,
        ibkr_statement_poll_seconds=0.0,
        ibkr_statement_poll_attempts=1,
        sync_cron_hour=0,
        sync_cron_minute=0,
    )


class SymbolsApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)
        with self.session_factory() as session:
            session.add_all(
                [
                    UsSymbol(symbol="AAPL", name="Apple Inc. - Common Stock", exchange="NASDAQ", is_etf=False),
                    UsSymbol(symbol="SPY", name="SPDR S&P 500 ETF Trust", exchange="NYSE Arca", is_etf=True),
                ]
            )
            session.commit()
        self.client = self._client()

    def tearDown(self) -> None:
        self.engine.dispose()

    def _client(self) -> TestClient:
        app = create_app(make_settings())

        def database_override():
            with self.session_factory() as session:
                yield session

        app.dependency_overrides[get_db] = database_override
        return TestClient(app)

    def test_symbol_lookup_returns_name_and_exchange(self) -> None:
        response = self.client.get("/api/symbols/AAPL")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["symbol"], "AAPL")
        self.assertEqual(body["name"], "Apple Inc. - Common Stock")
        self.assertEqual(body["exchange"], "NASDAQ")

    def test_symbol_lookup_is_case_insensitive(self) -> None:
        response = self.client.get("/api/symbols/spy")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["symbol"], "SPY")
        self.assertTrue(response.json()["is_etf"])

    def test_unknown_symbol_returns_404(self) -> None:
        response = self.client.get("/api/symbols/ZZZZ")
        self.assertEqual(response.status_code, 404)

    def test_search_route_still_resolves(self) -> None:
        # The dynamic /{symbol} route must not shadow the static /search route.
        response = self.client.get("/api/symbols/search", params={"q": "apple"})
        self.assertEqual(response.status_code, 200)
        symbols = [row["symbol"] for row in response.json()]
        self.assertIn("AAPL", symbols)


if __name__ == "__main__":
    unittest.main()
