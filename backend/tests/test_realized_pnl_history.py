import unittest
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import RawFlexReport, Trade
from app.services.realized_pnl import RealizedPnlService


class RealizedPnlHistoricalReportsTest(unittest.TestCase):
    def test_closed_lots_in_old_report_do_not_hide_newer_execution_pnl(self) -> None:
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        try:
            Base.metadata.create_all(engine)
            with Session(engine) as db:
                old = RawFlexReport(
                    query_id="historical", xml_path="/tmp/old.xml", xml_sha256="old",
                    downloaded_at=datetime.now(UTC), status="parsed",
                )
                recent = RawFlexReport(
                    query_id="daily", xml_path="/tmp/recent.xml", xml_sha256="recent",
                    downloaded_at=datetime.now(UTC), status="parsed",
                )
                db.add_all([old, recent])
                db.flush()
                db.add_all([
                    Trade(
                        raw_flex_report_id=old.id, report_date=date(2025, 12, 31),
                        trade_date=date(2025, 12, 31), currency="USD", symbol="ABC",
                        level_of_detail="EXECUTION", realized_pnl=Decimal("2.00"),
                    ),
                    Trade(
                        raw_flex_report_id=old.id, report_date=date(2025, 12, 31),
                        trade_date=date(2025, 12, 31), currency="USD", symbol="ABC",
                        level_of_detail="CLOSED_LOT", realized_pnl=Decimal("2.00"),
                    ),
                    Trade(
                        raw_flex_report_id=recent.id, report_date=date(2026, 6, 1),
                        trade_date=date(2026, 6, 1), currency="USD", symbol="XYZ",
                        level_of_detail="EXECUTION", realized_pnl=Decimal("1.50"),
                    ),
                ])
                db.commit()
                summary = RealizedPnlService().summary(db)
                self.assertEqual(summary["total_realized_pnl"], Decimal("3.50"))
        finally:
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
