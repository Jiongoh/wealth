import shutil
import tempfile
import unittest
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import CashActivity, LotAnalysisDaily, PositionLot, RawFlexReport, Trade
from app.services.ingestion_service import (
    IngestionError,
    IngestionService,
    _activities_from_cash_report,
    _cash_activity_records,
    _commission_activity_from_trade,
    _fx_base_activity_from_trade,
    _stock_trade_activity_from_trade,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "minimal_flex_statement.xml"


class FailingAnalysisService:
    def rebuild(self, db, raw_flex_report_id: int) -> int:
        raise RuntimeError("analysis failed")


class IngestionServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.xml_path = Path(self.temp_dir.name) / "statement.xml"
        shutil.copyfile(FIXTURE_PATH, self.xml_path)
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )
        with self.session_factory() as db:
            report = RawFlexReport(
                query_id="test-query",
                xml_path=str(self.xml_path),
                xml_sha256="fixture-hash",
                downloaded_at=datetime.now(UTC),
                status="archived",
            )
            db.add(report)
            db.commit()
            self.report_id = report.id

    def tearDown(self) -> None:
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_ingest_is_idempotent_and_generates_lot_analysis(self) -> None:
        with self.session_factory() as db:
            first = IngestionService().ingest_report(db, self.report_id)
            second = IngestionService().ingest_report(db, self.report_id)

            self.assertEqual(first.positions_lot, 1)
            self.assertEqual(second.positions_lot, 1)
            self.assertEqual(db.scalar(select(func.count(PositionLot.id))), 1)
            self.assertEqual(db.scalar(select(func.count(Trade.id))), 3)
            self.assertEqual(db.scalar(select(func.count(CashActivity.id))), 0)
            closed_lot = db.scalar(select(Trade).where(Trade.level_of_detail == "CLOSED_LOT"))
            self.assertEqual(closed_lot.realized_pnl, Decimal("1.25"))
            self.assertEqual(db.scalar(select(func.count(LotAnalysisDaily.id))), 1)
            analysis = db.scalar(select(LotAnalysisDaily))
            self.assertEqual(analysis.total_quantity, Decimal("2.5000000000"))
            self.assertEqual(analysis.avg_cost, Decimal("16.0500000000"))
            self.assertTrue(analysis.highest_cost_lot_profit_over_20)
            report = db.get(RawFlexReport, self.report_id)
            self.assertEqual(report.status, "parsed")

    def test_failed_reingestion_rolls_back_existing_rows_and_marks_report_failed(self) -> None:
        with self.session_factory() as db:
            IngestionService().ingest_report(db, self.report_id)

            with self.assertRaises(IngestionError):
                IngestionService(FailingAnalysisService()).ingest_report(db, self.report_id)

            self.assertEqual(db.scalar(select(func.count(PositionLot.id))), 1)
            report = db.get(RawFlexReport, self.report_id)
            self.assertEqual(report.status, "failed")
            self.assertIn("Flex XML ingestion failed", report.error_message)

    def test_historical_trade_scope_preserves_full_xml_but_imports_only_early_trades(self) -> None:
        with self.session_factory() as db:
            report = db.get(RawFlexReport, self.report_id)
            report.query_id = "historical-trades-before:2026-01-11"
            db.commit()

            result = IngestionService().ingest_report(db, self.report_id)
            self.assertEqual(result.trades, 2)
            self.assertEqual(result.positions_lot, 0)
            self.assertEqual(result.cash_report, 0)
            self.assertEqual(result.nav_daily, 0)
            self.assertEqual(result.lot_analysis_daily, 0)

            repeated = IngestionService().ingest_report(db, self.report_id)
            self.assertEqual(repeated.trades, 2)
            self.assertEqual(db.scalar(select(func.count(Trade.id))), 2)


class CashReportSummaryClassificationTest(unittest.TestCase):
    def _summary_record(self, deposit_withdrawals: str) -> dict:
        return {
            "report_date": "2026-07-02",
            "account_id": "U18361089",
            "currency": "CNH",
            "deposit_withdrawals": deposit_withdrawals,
        }

    def test_positive_deposit_withdrawals_is_classified_as_deposit(self) -> None:
        [activity] = _activities_from_cash_report(self._summary_record("10000"))
        self.assertEqual(activity["activity_type"], "DEPOSIT")
        self.assertEqual(activity["description"], "Cash report deposit")
        self.assertEqual(activity["amount"], Decimal("10000"))

    def test_negative_deposit_withdrawals_is_classified_as_withdrawal(self) -> None:
        [activity] = _activities_from_cash_report(self._summary_record("-2500"))
        self.assertEqual(activity["activity_type"], "WITHDRAWAL")
        self.assertEqual(activity["description"], "Cash report withdrawal")

    def test_commissions_field_no_longer_emits_aggregate_row(self) -> None:
        record = {
            "report_date": "2026-07-02",
            "account_id": "U18361089",
            "currency": "USD",
            "commissions": "-1.40",
        }
        self.assertEqual(_activities_from_cash_report(record), [])


class CommissionFromTradeTest(unittest.TestCase):
    def _trade(self, **overrides) -> dict:
        record = {
            "asset_class": "STK",
            "symbol": "MU",
            "buy_sell": "BUY",
            "quantity": "0.056",
            "ib_commission": "-0.35",
            "ib_commission_currency": "USD",
            "transaction_id": "tid-1",
            "trade_date": "2026-06-05",
            "account_id": "U18361089",
        }
        record.update(overrides)
        return record

    def test_buy_commission_is_attributed_to_side_and_symbol(self) -> None:
        activity = _commission_activity_from_trade(self._trade())
        self.assertEqual(activity["activity_type"], "COMMISSION")
        self.assertEqual(activity["description"], "Buy 0.056 MU")
        self.assertEqual(activity["symbol"], "MU")
        self.assertEqual(activity["currency"], "USD")
        self.assertEqual(activity["amount"], Decimal("-0.35"))
        self.assertEqual(activity["source_section"], "TRADES")
        self.assertEqual(activity["related_trade_id"], "tid-1")
        self.assertEqual(activity["external_id"], "commission-tid-1")

    def test_sell_commission_uses_sell_label_and_absolute_quantity(self) -> None:
        activity = _commission_activity_from_trade(
            self._trade(buy_sell="SELL", quantity="-0.14", symbol="SNDK", transaction_id="tid-2")
        )
        self.assertEqual(activity["description"], "Sell 0.14 SNDK")

    def test_zero_or_missing_commission_is_skipped(self) -> None:
        self.assertIsNone(_commission_activity_from_trade(self._trade(ib_commission="0")))
        self.assertIsNone(_commission_activity_from_trade(self._trade(ib_commission=None)))

    def test_fx_conversion_trade_is_skipped(self) -> None:
        self.assertIsNone(
            _commission_activity_from_trade(
                self._trade(asset_class="CASH", symbol="HKD.USD", ib_commission="-0.02")
            )
        )


class StockTradeCashActivityTest(unittest.TestCase):
    def _trade(self, **overrides) -> dict:
        record = {
            "report_date": datetime(2026, 9, 24).date(),
            "trade_date": datetime(2026, 9, 24).date(),
            "asset_class": "STK",
            "level_of_detail": "EXECUTION",
            "symbol": "DEMO",
            "currency": "USD",
            "buy_sell": "BUY",
            "quantity": Decimal("2"),
            "proceeds": Decimal("-100"),
            "ib_commission": Decimal("-0.35"),
            "net_cash": Decimal("-100.35"),
            "ib_execution_id": "exec-1",
            "transaction_id": "txn-1",
            "account_id": "TEST_ACCOUNT",
        }
        record.update(overrides)
        return record

    def test_buy_and_sell_proceeds_are_separate_from_commission(self) -> None:
        for side, proceeds, net_cash, expected_type in (
            ("BUY", Decimal("-100"), Decimal("-100.35"), "STOCK_BUY"),
            ("SELL", Decimal("120"), Decimal("119.65"), "STOCK_SELL"),
        ):
            with self.subTest(side=side):
                trade = self._trade(buy_sell=side, proceeds=proceeds, net_cash=net_cash)
                stock_activity = _stock_trade_activity_from_trade(trade)
                commission = _commission_activity_from_trade(trade)
                self.assertEqual(stock_activity["activity_type"], expected_type)
                self.assertEqual(stock_activity["amount"], proceeds)
                self.assertEqual(stock_activity["source_section"], "TRADES")
                self.assertEqual(stock_activity["related_trade_id"], "txn-1")
                self.assertEqual(stock_activity["external_id"], "stock-trade-exec-1")
                self.assertEqual(stock_activity["amount"] + commission["amount"], net_cash)
                activities = _cash_activity_records({"trades": [trade], "cash_report": []})
                self.assertEqual([row["activity_type"] for row in activities], ["COMMISSION", expected_type])

    def test_orders_closed_lots_fx_and_missing_proceeds_do_not_add_cash(self) -> None:
        for overrides in (
            {"level_of_detail": "ORDER"},
            {"level_of_detail": "CLOSED_LOT"},
            {"asset_class": "CASH", "symbol": "USD.HKD"},
            {"proceeds": None},
            {"proceeds": Decimal("0")},
        ):
            with self.subTest(overrides=overrides):
                self.assertIsNone(_stock_trade_activity_from_trade(self._trade(**overrides)))


class FxBaseCashActivityTest(unittest.TestCase):
    def _trade(self, **overrides) -> dict:
        record = {
            "report_date": datetime(2026, 7, 1).date(),
            "trade_date": datetime(2026, 7, 1).date(),
            "asset_class": "CASH",
            "level_of_detail": "EXECUTION",
            "symbol": "USD.CNH",
            "currency": "CNH",
            "buy_sell": "BUY",
            "quantity": Decimal("480"),
            "proceeds": Decimal("-3263.2464"),
            "net_cash": Decimal("0"),
            "ib_commission": Decimal("0"),
            "ib_commission_currency": "USD",
            "ib_execution_id": "fx-exec-1",
            "transaction_id": "fx-txn-1",
            "account_id": "TEST_ACCOUNT",
        }
        record.update(overrides)
        return record

    def test_buy_fx_creates_quote_debit_and_base_credit(self) -> None:
        activities = _cash_activity_records({"trades": [self._trade()], "cash_report": []})
        self.assertEqual(len(activities), 2)
        self.assertEqual([(row["currency"], row["amount"]) for row in activities], [
            ("CNH", Decimal("-3263.2464")),
            ("USD", Decimal("480")),
        ])
        self.assertEqual(activities[1]["activity_type"], "FX_CONVERSION")
        self.assertEqual(activities[1]["related_trade_id"], "fx-txn-1")
        self.assertEqual(activities[1]["external_id"], "fx-base-fx-exec-1")

    def test_sell_fx_creates_base_debit_and_base_currency_commission(self) -> None:
        activity = _fx_base_activity_from_trade(
            self._trade(
                buy_sell="SELL",
                quantity=Decimal("-10"),
                proceeds=Decimal("68"),
                ib_commission=Decimal("-0.25"),
            )
        )
        self.assertEqual(activity["currency"], "USD")
        self.assertEqual(activity["amount"], Decimal("-10.25"))
        self.assertIn("spent for CNH", activity["description"])

    def test_non_execution_or_unmatched_currency_cannot_infer_second_leg(self) -> None:
        for overrides in (
            {"level_of_detail": "ORDER"},
            {"symbol": "NOT_A_PAIR"},
            {"currency": "USD"},
            {"quantity": None},
            {"quantity": Decimal("0")},
            {"asset_class": "STK", "symbol": "DEMO"},
        ):
            with self.subTest(overrides=overrides):
                self.assertIsNone(_fx_base_activity_from_trade(self._trade(**overrides)))


if __name__ == "__main__":
    unittest.main()
