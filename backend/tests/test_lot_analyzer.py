import unittest
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import LotAnalysisDaily, PositionLot, RawFlexReport
from app.services.lot_analyzer import LotAnalyzer


class LotAnalyzerTest(unittest.TestCase):
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
        with self.session_factory() as db:
            report = RawFlexReport(
                query_id="test-query",
                xml_path="/tmp/test.xml",
                xml_sha256="analyzer-fixture-hash",
                downloaded_at=datetime.now(UTC),
                status="parsed",
            )
            db.add(report)
            db.commit()
            self.report_id = report.id

    def tearDown(self) -> None:
        self.engine.dispose()

    def _lot(self, **overrides) -> PositionLot:
        values = {
            "report_date": date(2026, 5, 27),
            "account_id": "TEST_ACCOUNT",
            "asset_class": "STK",
            "symbol": "DEMO",
            "conid": "1001",
            "quantity": Decimal("1"),
            "mark_price": Decimal("15"),
            "cost_basis_price": Decimal("10"),
            "cost_basis_money": Decimal("10"),
            "unrealized_pnl": Decimal("5"),
            "side": "LONG",
            "level_of_detail": "LOT",
            "raw_flex_report_id": self.report_id,
        }
        values.update(overrides)
        return PositionLot(**values)

    def test_calculates_multiple_long_stock_lots(self) -> None:
        with self.session_factory() as db:
            db.add_all(
                [
                    self._lot(
                        quantity=Decimal("4"),
                        cost_basis_price=Decimal("10"),
                        cost_basis_money=Decimal("40"),
                        unrealized_pnl=Decimal("20"),
                    ),
                    self._lot(
                        quantity=Decimal("6"),
                        cost_basis_price=Decimal("12"),
                        cost_basis_money=Decimal("72"),
                        unrealized_pnl=Decimal("18"),
                    ),
                ]
            )
            db.commit()

            count = LotAnalyzer().rebuild(db, raw_flex_report_id=self.report_id)
            db.commit()
            row = db.scalar(select(LotAnalysisDaily))

            self.assertEqual(count, 1)
            self.assertEqual(row.total_quantity, Decimal("10"))
            self.assertEqual(row.total_cost_basis_money, Decimal("112"))
            self.assertEqual(row.avg_cost, Decimal("11.2"))
            self.assertEqual(row.current_price, Decimal("15"))
            self.assertEqual(row.unrealized_pnl, Decimal("38"))
            self.assertEqual(row.highest_cost_lot_quantity, Decimal("6"))
            self.assertEqual(row.highest_cost_lot_price, Decimal("12"))
            self.assertEqual(row.highest_cost_lot_profit_pct, Decimal("0.25"))
            self.assertTrue(row.highest_cost_lot_profit_over_20)
            self.assertEqual(row.remaining_quantity_without_highest_lot, Decimal("4"))
            self.assertEqual(row.remaining_cost_without_highest_lot, Decimal("40"))
            self.assertEqual(row.avg_cost_without_highest_lot, Decimal("10"))

    def test_single_lot_sets_remaining_average_to_none_and_includes_20_percent(self) -> None:
        with self.session_factory() as db:
            db.add(
                self._lot(
                    quantity=Decimal("2"),
                    mark_price=Decimal("12"),
                    cost_basis_price=Decimal("10"),
                    cost_basis_money=Decimal("20"),
                )
            )
            db.commit()

            LotAnalyzer().rebuild(db, raw_flex_report_id=self.report_id)
            db.commit()
            row = db.scalar(select(LotAnalysisDaily))

            self.assertEqual(row.highest_cost_lot_profit_pct, Decimal("0.2"))
            self.assertTrue(row.highest_cost_lot_profit_over_20)
            self.assertEqual(row.remaining_quantity_without_highest_lot, Decimal("0"))
            self.assertEqual(row.remaining_cost_without_highest_lot, Decimal("0"))
            self.assertIsNone(row.avg_cost_without_highest_lot)

    def test_skips_short_non_stock_and_missing_price_groups(self) -> None:
        with self.session_factory() as db:
            db.add_all(
                [
                    self._lot(symbol="SHORT", conid="2001", side="SHORT"),
                    self._lot(symbol="OPTION", conid="2002", asset_class="OPT"),
                    self._lot(symbol="MISSING", conid="2003", mark_price=None),
                ]
            )
            db.commit()

            with self.assertLogs("app.services.lot_analyzer", level="WARNING"):
                count = LotAnalyzer().rebuild(db, raw_flex_report_id=self.report_id)
            db.commit()

            self.assertEqual(count, 0)
            self.assertEqual(db.scalar(select(func.count(LotAnalysisDaily.id))), 0)

    def test_rebuild_by_report_date_is_idempotent(self) -> None:
        with self.session_factory() as db:
            db.add(self._lot())
            db.commit()

            first = LotAnalyzer().rebuild(db, report_date=date(2026, 5, 27))
            db.commit()
            second = LotAnalyzer().rebuild(db, report_date=date(2026, 5, 27))
            db.commit()

            self.assertEqual(first, 1)
            self.assertEqual(second, 1)
            self.assertEqual(db.scalar(select(func.count(LotAnalysisDaily.id))), 1)


if __name__ == "__main__":
    unittest.main()
