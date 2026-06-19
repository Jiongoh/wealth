import shutil
import tempfile
import unittest
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models import CashActivity, CashReport, LotAnalysisDaily, NavDaily, PositionLot, RawFlexReport, Trade
from app.services.ingestion_service import IngestionService

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "minimal_flex_statement.xml"


def make_settings() -> Settings:
    return Settings(
        app_name="ibkr-query-test",
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
    )


class QueryApiTest(unittest.TestCase):
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
        app = create_app(make_settings())

        def database_override():
            with self.session_factory() as session:
                yield session

        app.dependency_overrides[get_db] = database_override
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _ingest_fixture(self) -> None:
        xml_path = Path(self.temp_dir.name) / "statement.xml"
        shutil.copyfile(FIXTURE_PATH, xml_path)
        with self.session_factory() as db:
            report = RawFlexReport(
                query_id="test-query",
                xml_path=str(xml_path),
                xml_sha256="query-api-fixture-hash",
                downloaded_at=datetime.now(UTC),
                status="archived",
            )
            db.add(report)
            db.commit()
            IngestionService().ingest_report(db, report.id)

    def test_query_endpoints_return_empty_results_without_data(self) -> None:
        self.assertIsNone(self.client.get("/api/portfolio/summary").json())
        for path in (
            "/api/portfolio/nav/history",
            "/api/positions/current",
            "/api/positions/lots",
            "/api/positions/lots/analysis",
            "/api/cash/history",
            "/api/portfolio/performance/daily",
            "/api/pnl/realized/daily",
            "/api/pnl/realized/by-symbol",
            "/api/watchlist",
            "/api/watchlist/tags",
        ):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertEqual(response.json(), [], path)
        cash_balances = self.client.get("/api/cash/balances/timeseries")
        self.assertEqual(cash_balances.status_code, 200)
        self.assertEqual(cash_balances.json(), {"items": [], "currencies": []})
        cash_activities = self.client.get("/api/cash/activities")
        self.assertEqual(cash_activities.status_code, 200)
        self.assertEqual(
            cash_activities.json(),
            {
                "items": [],
                "total_count": 0,
                "by_type": {
                    "DEPOSIT": 0,
                    "WITHDRAWAL": 0,
                    "FX_CONVERSION": 0,
                    "DIVIDEND": 0,
                    "INTEREST": 0,
                    "COMMISSION": 0,
                    "TAX": 0,
                    "FEE": 0,
                    "OTHER": 0,
                },
            },
        )
        trades = self.client.get("/api/trades")
        self.assertEqual(trades.status_code, 200)
        self.assertEqual(
            trades.json(),
            {
                "items": [],
                "total_count": 0,
                "buy_count": 0,
                "sell_count": 0,
                "symbol_filter": "All",
            },
        )
        realized_summary = self.client.get("/api/pnl/realized/summary")
        self.assertEqual(realized_summary.status_code, 200)
        self.assertEqual(Decimal(realized_summary.json()["total_realized_pnl"]), Decimal("0"))
        self.assertIsNone(realized_summary.json()["currency"])
        status = self.client.get("/api/sync/status")
        self.assertEqual(status.status_code, 200)
        self.assertIsNone(status.json()["latest_run"])

    def test_query_endpoints_return_ingested_data_and_calculated_positions(self) -> None:
        self._ingest_fixture()
        with self.session_factory() as db:
            report = db.scalar(select(RawFlexReport))
            self.assertIsNotNone(report)
            fx_trade_datetime = datetime(2026, 1, 10, 10, 0)
            db.add(
                Trade(
                    report_date=date(2026, 1, 31),
                    account_id="TEST_ACCOUNT",
                    currency="HKD",
                    asset_class="CASH",
                    symbol="USD.HKD",
                    conid="0",
                    datetime=fx_trade_datetime,
                    trade_date=date(2026, 1, 10),
                    quantity=Decimal("1"),
                    trade_price=Decimal("7.8"),
                    trade_money=Decimal("7.8"),
                    net_cash=Decimal("7.8"),
                    buy_sell="BUY",
                    raw_flex_report_id=report.id,
                )
            )
            db.add(
                CashActivity(
                    report_date=date(2026, 1, 31),
                    activity_date=date(2026, 1, 10),
                    activity_datetime=fx_trade_datetime,
                    account_id="TEST_ACCOUNT",
                    currency="HKD",
                    amount=Decimal("7.8"),
                    activity_type="FX_CONVERSION",
                    description="USD.HKD auto FX conversion",
                    source_section="TRADES",
                    symbol="USD.HKD",
                    fx_pair="USD.HKD",
                    external_id="fx-test",
                    raw_flex_report_id=report.id,
                )
            )
            db.commit()

        summary = self.client.get("/api/portfolio/summary").json()
        self.assertEqual(summary["report_date"], "2026-01-31")
        self.assertEqual(Decimal(summary["total_nav"]), Decimal("176.125"))
        self.assertEqual(Decimal(summary["unrealized_pnl"]), Decimal("10.50"))
        self.assertEqual(summary["currency"], "USD")

        nav = self.client.get(
            "/api/portfolio/nav/history?start_date=2026-01-01&end_date=2026-01-31"
        ).json()
        self.assertEqual(len(nav), 1)

        positions = self.client.get("/api/positions/current").json()
        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0]["symbol"], "DEMO")
        self.assertEqual(Decimal(positions[0]["market_value"]), Decimal("50.625"))
        self.assertEqual(Decimal(positions[0]["weight_pct"]), Decimal("1"))

        lots = self.client.get("/api/positions/lots?symbol=DEMO").json()
        analysis = self.client.get("/api/positions/lots/analysis").json()
        self.assertEqual(len(lots), 1)
        self.assertEqual(len(analysis), 1)
        self.assertEqual(lots[0]["level_of_detail"], "LOT")

        trades = self.client.get(
            "/api/trades?symbol=DEMO&start_date=2026-01-10&end_date=2026-01-10&limit=10"
        ).json()
        self.assertEqual(len(trades["items"]), 2)
        self.assertEqual(trades["total_count"], 2)
        self.assertEqual(trades["buy_count"], 1)
        self.assertEqual(trades["sell_count"], 1)
        self.assertEqual(trades["symbol_filter"], "DEMO")
        all_trades = self.client.get(
            "/api/trades?start_date=2026-01-10&end_date=2026-01-10"
        ).json()
        self.assertEqual(all_trades["total_count"], 2)
        self.assertNotIn("USD.HKD", {row["symbol"] for row in all_trades["items"]})
        with self.session_factory() as db:
            self.assertEqual(
                len(db.scalars(select(Trade).where(Trade.symbol == "USD.HKD")).all()),
                1,
            )
        cash_activities = self.client.get(
            "/api/cash/activities?start_date=2026-01-10&end_date=2026-01-10"
        ).json()
        self.assertEqual(cash_activities["total_count"], 1)
        self.assertEqual(cash_activities["by_type"]["FX_CONVERSION"], 1)
        self.assertEqual(cash_activities["items"][0]["symbol"], "USD.HKD")
        self.assertEqual(Decimal(cash_activities["items"][0]["amount"]), Decimal("7.8000000000"))

        realized_summary = self.client.get("/api/pnl/realized/summary").json()
        self.assertEqual(Decimal(realized_summary["total_realized_pnl"]), Decimal("1.25"))
        self.assertIsNone(realized_summary["currency"])
        self.assertEqual(realized_summary["start_date"], "2026-01-10")
        self.assertEqual(realized_summary["end_date"], "2026-01-10")

        realized_daily = self.client.get(
            "/api/pnl/realized/daily?start_date=2026-01-01&end_date=2026-01-31&symbol=DEMO"
        ).json()
        self.assertEqual(len(realized_daily), 1)
        self.assertEqual(realized_daily[0]["date"], "2026-01-10")
        self.assertEqual(Decimal(realized_daily[0]["realized_pnl"]), Decimal("1.25"))
        self.assertEqual(realized_daily[0]["trade_count"], 1)

        realized_by_symbol = self.client.get("/api/pnl/realized/by-symbol").json()
        self.assertEqual(len(realized_by_symbol), 1)
        self.assertEqual(realized_by_symbol[0]["symbol"], "DEMO")
        self.assertEqual(realized_by_symbol[0]["conid"], "1001")
        self.assertEqual(Decimal(realized_by_symbol[0]["realized_pnl"]), Decimal("1.25"))

        cash = self.client.get(
            "/api/cash/history?start_date=2026-01-01&end_date=2026-01-31"
        ).json()
        self.assertEqual(len(cash), 1)
        self.assertEqual(cash[0]["report_date"], "2026-01-31")

        usd_cash = self.client.get("/api/cash/history?currency=usd").json()
        self.assertEqual(len(usd_cash), 1)
        self.assertEqual(usd_cash[0]["currency"], "USD")

        cash_balances = self.client.get(
            "/api/cash/balances/timeseries?start_date=2026-01-01&end_date=2026-01-31"
        ).json()
        self.assertEqual(cash_balances["currencies"], ["USD"])
        balance_keys = set(cash_balances["items"][0])
        self.assertEqual(balance_keys, {"date", "currency", "balance"})
        balances_by_currency = {row["currency"]: row for row in cash_balances["items"]}
        self.assertEqual(balances_by_currency["USD"]["date"], "2026-01-31")
        self.assertEqual(Decimal(balances_by_currency["USD"]["balance"]), Decimal("125.50"))

        usd_balances = self.client.get("/api/cash/balances/timeseries?currency=usd").json()
        self.assertEqual(usd_balances["currencies"], ["USD"])
        self.assertEqual({row["currency"] for row in usd_balances["items"]}, {"USD"})

    def test_current_positions_use_latest_raw_report_for_duplicate_report_date(self) -> None:
        self._ingest_fixture()
        with self.session_factory() as db:
            existing = db.scalar(select(LotAnalysisDaily))
            existing_lot = db.scalar(select(PositionLot))
            existing_nav = db.scalar(select(NavDaily))
            existing_cash = db.scalar(select(CashReport))
            self.assertIsNotNone(existing)
            self.assertIsNotNone(existing_lot)
            self.assertIsNotNone(existing_nav)
            self.assertIsNotNone(existing_cash)
            report = RawFlexReport(
                query_id="test-query",
                xml_path=str(FIXTURE_PATH),
                xml_sha256="query-api-fixture-hash-latest",
                downloaded_at=datetime.now(UTC),
                status="archived",
            )
            db.add(report)
            db.flush()
            db.add(
                NavDaily(
                    report_date=existing_nav.report_date,
                    account_id=existing_nav.account_id,
                    currency=existing_nav.currency,
                    cash=existing_nav.cash,
                    stock=existing_nav.stock,
                    options=existing_nav.options,
                    funds=existing_nav.funds,
                    dividend_accruals=existing_nav.dividend_accruals,
                    interest_accruals=existing_nav.interest_accruals,
                    broker_interest_accruals_component=existing_nav.broker_interest_accruals_component,
                    margin_financing_charge_accruals=existing_nav.margin_financing_charge_accruals,
                    crypto=existing_nav.crypto,
                    total=existing_nav.total,
                    raw_flex_report_id=report.id,
                )
            )
            db.add(
                CashReport(
                    report_date=existing_cash.report_date,
                    account_id=existing_cash.account_id,
                    currency=existing_cash.currency,
                    level_of_detail=existing_cash.level_of_detail,
                    from_date=existing_cash.from_date,
                    to_date=existing_cash.to_date,
                    starting_cash=existing_cash.starting_cash,
                    deposits=existing_cash.deposits,
                    withdrawals=existing_cash.withdrawals,
                    deposit_withdrawals=existing_cash.deposit_withdrawals,
                    dividends=existing_cash.dividends,
                    broker_interest_paid_received=existing_cash.broker_interest_paid_received,
                    commissions=existing_cash.commissions,
                    net_trades_sales=existing_cash.net_trades_sales,
                    net_trades_purchases=existing_cash.net_trades_purchases,
                    withholding_tax=existing_cash.withholding_tax,
                    transaction_tax=existing_cash.transaction_tax,
                    fx_translation_gain_loss=existing_cash.fx_translation_gain_loss,
                    other_fees=existing_cash.other_fees,
                    other_income=existing_cash.other_income,
                    other=existing_cash.other,
                    ending_cash=existing_cash.ending_cash,
                    ending_settled_cash=existing_cash.ending_settled_cash,
                    raw_flex_report_id=report.id,
                )
            )
            db.add(
                PositionLot(
                    report_date=existing_lot.report_date,
                    account_id=existing_lot.account_id,
                    currency=existing_lot.currency,
                    asset_class=existing_lot.asset_class,
                    symbol=existing_lot.symbol,
                    description=existing_lot.description,
                    conid=existing_lot.conid,
                    quantity=existing_lot.quantity,
                    mark_price=existing_lot.mark_price,
                    position_value=existing_lot.position_value,
                    open_price=existing_lot.open_price,
                    cost_basis_price=existing_lot.cost_basis_price,
                    cost_basis_money=existing_lot.cost_basis_money,
                    unrealized_pnl=existing_lot.unrealized_pnl,
                    side=existing_lot.side,
                    level_of_detail=existing_lot.level_of_detail,
                    open_datetime=existing_lot.open_datetime,
                    holding_period_datetime=existing_lot.holding_period_datetime,
                    originating_order_id=existing_lot.originating_order_id,
                    originating_transaction_id=existing_lot.originating_transaction_id,
                    raw_flex_report_id=report.id,
                )
            )
            db.add(
                LotAnalysisDaily(
                    report_date=existing.report_date,
                    account_id=existing.account_id,
                    symbol=existing.symbol,
                    conid=existing.conid,
                    total_quantity=existing.total_quantity,
                    current_price=existing.current_price,
                    total_cost_basis_money=existing.total_cost_basis_money,
                    avg_cost=existing.avg_cost,
                    unrealized_pnl=existing.unrealized_pnl,
                    raw_flex_report_id=report.id,
                )
            )
            db.commit()

        positions = self.client.get("/api/positions/current").json()
        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0]["symbol"], "DEMO")
        self.assertEqual(Decimal(positions[0]["weight_pct"]), Decimal("1"))
        lots = self.client.get("/api/positions/lots").json()
        self.assertEqual(len(lots), 1)
        analysis = self.client.get("/api/positions/lots/analysis").json()
        self.assertEqual(len(analysis), 1)

        summary = self.client.get("/api/portfolio/summary").json()
        self.assertEqual(Decimal(summary["total_nav"]), Decimal("176.1250000000"))
        self.assertEqual(Decimal(summary["unrealized_pnl"]), Decimal("10.5000000000"))
        nav_history = self.client.get("/api/portfolio/nav/history").json()
        self.assertEqual(len(nav_history), 1)
        self.assertEqual(Decimal(nav_history[0]["total"]), Decimal("176.1250000000"))
        performance = self.client.get("/api/portfolio/performance/daily").json()
        self.assertEqual(len(performance), 1)
        self.assertIsNone(performance[0]["previous_nav"])
        self.assertIsNone(performance[0]["performance_amount"])
        cash_history = self.client.get("/api/cash/history").json()
        self.assertEqual(len(cash_history), 1)
        cash_balances = self.client.get("/api/cash/balances/timeseries").json()
        self.assertEqual(len(cash_balances["items"]), 1)
        self.assertEqual(cash_balances["currencies"], ["USD"])

    def test_portfolio_performance_adjusts_deposits_and_withdrawals(self) -> None:
        with self.session_factory() as db:
            first_report = RawFlexReport(
                query_id="performance-test",
                xml_path=str(FIXTURE_PATH),
                xml_sha256="performance-test-first",
                downloaded_at=datetime(2026, 2, 1, tzinfo=UTC),
                status="parsed",
            )
            second_report = RawFlexReport(
                query_id="performance-test",
                xml_path=str(FIXTURE_PATH),
                xml_sha256="performance-test-second",
                downloaded_at=datetime(2026, 2, 2, tzinfo=UTC),
                status="parsed",
            )
            db.add_all([first_report, second_report])
            db.flush()
            db.add_all(
                [
                    NavDaily(
                        report_date=date(2026, 1, 30),
                        account_id="TEST_ACCOUNT",
                        currency="USD",
                        total=Decimal("100"),
                        raw_flex_report_id=first_report.id,
                    ),
                    NavDaily(
                        report_date=date(2026, 1, 31),
                        account_id="TEST_ACCOUNT",
                        currency="USD",
                        total=Decimal("115"),
                        raw_flex_report_id=second_report.id,
                    ),
                    CashReport(
                        report_date=date(2026, 1, 31),
                        account_id="TEST_ACCOUNT",
                        currency="USD",
                        level_of_detail="SUMMARY",
                        deposits=Decimal("999"),
                        withdrawals=Decimal("0"),
                        deposit_withdrawals=Decimal("10"),
                        raw_flex_report_id=second_report.id,
                    ),
                ]
            )
            db.commit()

        response = self.client.get("/api/portfolio/performance/daily")
        self.assertEqual(response.status_code, 200)
        rows = response.json()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["date"], "2026-01-30")
        self.assertIsNone(rows[0]["performance_amount"])
        self.assertEqual(rows[1]["date"], "2026-01-31")
        self.assertEqual(Decimal(rows[1]["nav"]), Decimal("115.0000000000"))
        self.assertEqual(Decimal(rows[1]["previous_nav"]), Decimal("100.0000000000"))
        self.assertEqual(Decimal(rows[1]["external_cash_flow"]), Decimal("10.0000000000"))
        self.assertEqual(Decimal(rows[1]["performance_amount"]), Decimal("5.0000000000"))
        self.assertEqual(Decimal(rows[1]["performance_pct"]), Decimal("0.0500000000"))
        self.assertEqual(
            rows[1]["external_cash_flows"],
            [{"currency": "USD", "amount": "10.0000000000"}],
        )

    def test_portfolio_performance_excludes_foreign_currency_cash_flow(self) -> None:
        with self.session_factory() as db:
            first_report = RawFlexReport(
                query_id="fx-performance-test",
                xml_path=str(FIXTURE_PATH),
                xml_sha256="fx-performance-first",
                downloaded_at=datetime(2026, 2, 1, tzinfo=UTC),
                status="parsed",
            )
            second_report = RawFlexReport(
                query_id="fx-performance-test",
                xml_path=str(FIXTURE_PATH),
                xml_sha256="fx-performance-second",
                downloaded_at=datetime(2026, 2, 2, tzinfo=UTC),
                status="parsed",
            )
            db.add_all([first_report, second_report])
            db.flush()
            db.add_all(
                [
                    NavDaily(
                        report_date=date(2026, 1, 30),
                        account_id="TEST_ACCOUNT",
                        currency="USD",
                        total=Decimal("100"),
                        raw_flex_report_id=first_report.id,
                    ),
                    NavDaily(
                        report_date=date(2026, 1, 31),
                        account_id="TEST_ACCOUNT",
                        currency="USD",
                        total=Decimal("115"),
                        raw_flex_report_id=second_report.id,
                    ),
                    # A 1000 CNH deposit must NOT be subtracted from a USD NAV.
                    CashReport(
                        report_date=date(2026, 1, 31),
                        account_id="TEST_ACCOUNT",
                        currency="CNH",
                        level_of_detail="Currency",
                        deposit_withdrawals=Decimal("1000"),
                        raw_flex_report_id=second_report.id,
                    ),
                ]
            )
            db.commit()

        rows = self.client.get("/api/portfolio/performance/daily").json()
        day = rows[1]
        self.assertEqual(day["date"], "2026-01-31")
        # Base-currency cash flow is zero -> the CNH deposit is excluded from
        # the performance calculation rather than added as raw USD.
        self.assertEqual(Decimal(day["external_cash_flow"]), Decimal("0"))
        self.assertEqual(Decimal(day["performance_amount"]), Decimal("15.0000000000"))
        self.assertEqual(
            day["external_cash_flows"],
            [{"currency": "CNH", "amount": "1000.0000000000"}],
        )

    def test_cash_balance_timeseries_returns_normalized_currency_balances(self) -> None:
        self._ingest_fixture()

        response = self.client.get(
            "/api/cash/balances/timeseries?start_date=2026-01-01&end_date=2026-01-31"
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["currencies"], ["USD"])
        self.assertEqual(payload["items"], [{"date": "2026-01-31", "currency": "USD", "balance": "125.5000000000"}])

        usd_response = self.client.get("/api/cash/balances/timeseries?currency=usd")
        self.assertEqual(usd_response.status_code, 200)
        self.assertEqual(usd_response.json()["currencies"], ["USD"])

    def test_watchlist_crud_tags_filter_and_position_status(self) -> None:
        self._ingest_fixture()

        created = self.client.post(
            "/api/watchlist",
            json={"symbol": " cohr ", "tags": ["CPO", "Optical"], "notes": "Interesting optics"},
        )
        self.assertEqual(created.status_code, 200)
        created_item = created.json()
        self.assertEqual(created_item["symbol"], "COHR")
        self.assertEqual(created_item["tags"], ["CPO", "Optical"])
        self.assertFalse(created_item["has_position"])

        # Symbols are unique: re-adding (any case/whitespace) is rejected with
        # 409 instead of silently overwriting the existing entry.
        duplicate = self.client.post(
            "/api/watchlist",
            json={"symbol": "COHR", "tags": ["Different"]},
        )
        self.assertEqual(duplicate.status_code, 409)
        cohr_rows = [row for row in self.client.get("/api/watchlist").json() if row["symbol"] == "COHR"]
        self.assertEqual(len(cohr_rows), 1)
        self.assertEqual(cohr_rows[0]["tags"], ["CPO", "Optical"])

        holding = self.client.post(
            "/api/watchlist",
            json={"symbol": "DEMO", "tags": ["CPO", "Semiconductor"]},
        ).json()
        self.assertTrue(holding["has_position"])
        self.assertEqual(holding["latest_report_date"], "2026-01-31")
        self.assertEqual(Decimal(holding["position_quantity"]), Decimal("2.5000000000"))

        filtered = self.client.get("/api/watchlist?tag=cpo").json()
        self.assertEqual([item["symbol"] for item in filtered], ["COHR", "DEMO"])
        searched = self.client.get("/api/watchlist?q=co").json()
        self.assertEqual([item["symbol"] for item in searched], ["COHR"])

        tags = self.client.get("/api/watchlist/tags").json()
        counts = {row["name"]: row["count"] for row in tags}
        self.assertEqual(counts["CPO"], 2)
        self.assertEqual(counts["Optical"], 1)
        colors = {row["name"]: row["color"] for row in tags}
        self.assertTrue(colors["CPO"].startswith("#"))

        updated = self.client.patch(
            "/api/watchlist/COHR",
            json={"tags": ["AI Infra", "Optical"], "notes": "Updated"},
        ).json()
        self.assertEqual(updated["tags"], ["AI Infra", "Optical"])
        self.assertEqual(updated["notes"], "Updated")

        created_tags = self.client.post(
            "/api/watchlist/tags",
            json={"names": ["CPO", "AI Infra", "Quantum"]},
        )
        self.assertEqual(created_tags.status_code, 200)
        tag_names = {row["name"] for row in created_tags.json()}
        self.assertIn("Quantum", tag_names)

        typo_item = self.client.post(
            "/api/watchlist",
            json={"symbol": "TYPO", "tags": ["semicondutor"]},
        )
        self.assertEqual(typo_item.status_code, 200)
        tags_after_typo = self.client.get("/api/watchlist/tags").json()
        tag_ids = {row["name"]: row["id"] for row in tags_after_typo}
        merge_response = self.client.patch(
            f"/api/watchlist/tags/{tag_ids['semicondutor']}",
            json={"name": "Semiconductor"},
        )
        self.assertEqual(merge_response.status_code, 200)
        self.assertEqual(merge_response.json()["name"], "Semiconductor")
        merged_tags = self.client.get("/api/watchlist/tags").json()
        merged_counts = {row["name"]: row["count"] for row in merged_tags}
        self.assertNotIn("semicondutor", merged_counts)
        self.assertEqual(merged_counts["Semiconductor"], 2)
        typo_after_merge = self.client.get("/api/watchlist?q=typo").json()
        self.assertEqual(typo_after_merge[0]["tags"], ["Semiconductor"])

        quantum_id = {row["name"]: row["id"] for row in merged_tags}["Quantum"]
        delete_tag_response = self.client.delete(f"/api/watchlist/tags/{quantum_id}")
        self.assertEqual(delete_tag_response.status_code, 200)
        self.assertTrue(delete_tag_response.json()["success"])
        after_tag_delete = self.client.get("/api/watchlist/tags").json()
        self.assertNotIn("Quantum", {row["name"] for row in after_tag_delete})
        self.assertEqual(len(self.client.get("/api/watchlist").json()), 3)

        too_many_tags = self.client.post(
            "/api/watchlist/tags",
            json={"names": ["One", "Two", "Three", "Four", "Five", "Six"]},
        )
        self.assertEqual(too_many_tags.status_code, 422)

        too_many_ticker_tags = self.client.patch(
            "/api/watchlist/COHR",
            json={"tags": ["One", "Two", "Three", "Four", "Five", "Six"]},
        )
        self.assertEqual(too_many_ticker_tags.status_code, 422)

        delete_response = self.client.delete("/api/watchlist/COHR")
        self.assertEqual(delete_response.status_code, 204)
        remaining = self.client.get("/api/watchlist").json()
        self.assertEqual([item["symbol"] for item in remaining], ["DEMO", "TYPO"])

    def test_invalid_query_parameters_return_validation_errors(self) -> None:
        invalid_range = self.client.get(
            "/api/portfolio/nav/history?start_date=2026-02-01&end_date=2026-01-01"
        )
        invalid_limit = self.client.get("/api/trades?limit=0")

        self.assertEqual(invalid_range.status_code, 422)
        self.assertEqual(invalid_limit.status_code, 422)

    def test_trades_dedupes_same_execution_across_overlapping_reports(self) -> None:
        with self.session_factory() as db:
            first_report = RawFlexReport(
                query_id="test-query",
                xml_path="/tmp/first.xml",
                xml_sha256="first-trades-report",
                downloaded_at=datetime(2026, 6, 6, tzinfo=UTC),
                status="parsed",
            )
            second_report = RawFlexReport(
                query_id="test-query",
                xml_path="/tmp/second.xml",
                xml_sha256="second-trades-report",
                downloaded_at=datetime(2026, 6, 8, tzinfo=UTC),
                status="parsed",
            )
            db.add_all([first_report, second_report])
            db.flush()
            shared_execution = {
                "account_id": "TEST_ACCOUNT",
                "currency": "USD",
                "asset_class": "STK",
                "symbol": "MU",
                "conid": "2002",
                "datetime": datetime(2026, 6, 5, 14, 30),
                "trade_date": date(2026, 6, 5),
                "quantity": Decimal("0.055"),
                "trade_price": Decimal("914.97"),
                "buy_sell": "BUY",
                "transaction_id": "40482724612",
                "ib_execution_id": "00012971.6a250e38.01.01",
                "level_of_detail": "EXECUTION",
            }
            # Two identical fills inside one report are real separate trades
            # and must both survive the dedupe.
            twin_fill = {
                "account_id": "TEST_ACCOUNT",
                "currency": "USD",
                "asset_class": "STK",
                "symbol": "MU",
                "conid": "2002",
                "datetime": datetime(2026, 6, 5, 15, 0),
                "trade_date": date(2026, 6, 5),
                "quantity": Decimal("1"),
                "trade_price": Decimal("900"),
                "buy_sell": "SELL",
                "level_of_detail": "EXECUTION",
            }
            db.add_all(
                [
                    Trade(**shared_execution, report_date=date(2026, 6, 5), raw_flex_report_id=first_report.id),
                    Trade(**shared_execution, report_date=date(2026, 6, 5), raw_flex_report_id=second_report.id),
                    Trade(**twin_fill, report_date=date(2026, 6, 5), raw_flex_report_id=second_report.id),
                    Trade(
                        **{**twin_fill, "datetime": datetime(2026, 6, 5, 15, 0)},
                        report_date=date(2026, 6, 5),
                        raw_flex_report_id=second_report.id,
                    ),
                ]
            )
            db.commit()

        trades = self.client.get("/api/trades?symbol=MU").json()
        self.assertEqual(trades["total_count"], 3)
        self.assertEqual(trades["buy_count"], 1)
        self.assertEqual(trades["sell_count"], 2)
        execution_ids = [row["ib_execution_id"] for row in trades["items"] if row["ib_execution_id"]]
        self.assertEqual(execution_ids, ["00012971.6a250e38.01.01"])

    def test_realized_pnl_dedupes_overlapping_reports_and_uses_date_fallback(self) -> None:
        with self.session_factory() as db:
            first_report = RawFlexReport(
                query_id="test-query",
                xml_path="/tmp/first.xml",
                xml_sha256="first-realized-report",
                downloaded_at=datetime.now(UTC),
                status="parsed",
            )
            second_report = RawFlexReport(
                query_id="test-query",
                xml_path="/tmp/second.xml",
                xml_sha256="second-realized-report",
                downloaded_at=datetime.now(UTC),
                status="parsed",
            )
            db.add_all([first_report, second_report])
            db.flush()
            shared_trade = {
                "report_date": date(2026, 2, 2),
                "account_id": "TEST_ACCOUNT",
                "currency": "USD",
                "asset_class": "STK",
                "symbol": "DEMO",
                "conid": "1001",
                "datetime": datetime(2026, 2, 1, 9, 30),
                "quantity": Decimal("1"),
                "cost_basis": Decimal("10"),
                "realized_pnl": Decimal("2.50"),
                "level_of_detail": "CLOSED_LOT",
            }
            db.add_all(
                [
                    Trade(**shared_trade, raw_flex_report_id=first_report.id),
                    Trade(**shared_trade, raw_flex_report_id=second_report.id),
                    Trade(
                        report_date=date(2026, 2, 1),
                        account_id="TEST_ACCOUNT",
                        currency="USD",
                        asset_class="STK",
                        symbol="DEMO",
                        conid="1001",
                        trade_date=date(2026, 2, 1),
                        realized_pnl=Decimal("99"),
                        level_of_detail="EXECUTION",
                        raw_flex_report_id=second_report.id,
                    ),
                    Trade(
                        report_date=date(2026, 2, 1),
                        account_id="TEST_ACCOUNT",
                        currency="HKD",
                        asset_class="CASH",
                        symbol="USD.HKD",
                        conid="12345777",
                        trade_date=date(2026, 2, 1),
                        realized_pnl=Decimal("0"),
                        level_of_detail="CLOSED_LOT",
                        raw_flex_report_id=second_report.id,
                    ),
                    Trade(
                        report_date=date(2026, 2, 3),
                        account_id="TEST_ACCOUNT",
                        currency="USD",
                        asset_class="STK",
                        symbol="ZERO",
                        conid="1002",
                        trade_date=date(2026, 2, 3),
                        realized_pnl=Decimal("0"),
                        level_of_detail="CLOSED_LOT",
                        raw_flex_report_id=second_report.id,
                    ),
                ]
            )
            db.commit()

        daily = self.client.get("/api/pnl/realized/daily").json()
        self.assertEqual(len(daily), 1)
        self.assertEqual(daily[0]["date"], "2026-02-01")
        self.assertEqual(Decimal(daily[0]["realized_pnl"]), Decimal("2.50"))
        self.assertEqual(daily[0]["trade_count"], 1)

        by_symbol = self.client.get("/api/pnl/realized/by-symbol").json()
        self.assertEqual([row["symbol"] for row in by_symbol], ["DEMO"])


if __name__ == "__main__":
    unittest.main()
