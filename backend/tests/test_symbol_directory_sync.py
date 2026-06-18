import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import UsSymbol
from app.services.symbol_directory_sync import (
    NASDAQ_LISTED_URL,
    OTHER_LISTED_URL,
    SymbolDirectorySyncService,
)

NASDAQ_LISTED_SAMPLE = (
    "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\n"
    "AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N\n"
    "SPCX|Space Exploration Technologies Corp. - Class A Common Stock|Q|N|N|100|N|N\n"
    "ZTEST|Nasdaq Test Issue|G|Y|N|100|N|N\n"
    "File Creation Time: 0618202608:31|||||||\n"
).encode("utf-8")

OTHER_LISTED_SAMPLE = (
    "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\n"
    "A|Agilent Technologies, Inc. Common Stock|N|A|N|100|N|A\n"
    "SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY\n"
    "File Creation Time: 0618202608:31||||||\n"
).encode("utf-8")


def fake_fetch(url: str) -> bytes:
    if url == NASDAQ_LISTED_URL:
        return NASDAQ_LISTED_SAMPLE
    if url == OTHER_LISTED_URL:
        return OTHER_LISTED_SAMPLE
    raise AssertionError(f"unexpected url: {url}")


class SymbolDirectorySyncTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_sync_from_nasdaq_imports_both_files(self) -> None:
        with self.session_factory() as db:
            result = SymbolDirectorySyncService().sync_from_nasdaq(db, fetch=fake_fetch)

        self.assertEqual(result.status, "success")
        # 3 nasdaq rows (trailer skipped) + 2 other rows.
        self.assertEqual(result.rows_total, 5)
        self.assertEqual(result.rows_inserted, 5)

        with self.session_factory() as db:
            symbols = {row.symbol: row for row in db.scalars(select(UsSymbol)).all()}

        self.assertIn("SPCX", symbols)
        self.assertEqual(symbols["SPCX"].name, "Space Exploration Technologies Corp. - Class A Common Stock")
        self.assertEqual(symbols["SPCX"].exchange, "NASDAQ")
        self.assertEqual(symbols["SPCX"].source_file, "nasdaqlisted.txt")
        self.assertIs(symbols["SPCX"].is_etf, False)

    def test_other_listed_exchange_codes_are_mapped(self) -> None:
        with self.session_factory() as db:
            SymbolDirectorySyncService().sync_from_nasdaq(db, fetch=fake_fetch)
            rows = {row.symbol: row for row in db.scalars(select(UsSymbol)).all()}

        self.assertEqual(rows["A"].exchange, "NYSE")
        self.assertEqual(rows["SPY"].exchange, "NYSE Arca")
        self.assertIs(rows["SPY"].is_etf, True)
        self.assertEqual(rows["SPY"].source_file, "otherlisted.txt")

    def test_trailer_line_is_skipped(self) -> None:
        with self.session_factory() as db:
            SymbolDirectorySyncService().sync_from_nasdaq(db, fetch=fake_fetch)
            symbols = {row.symbol for row in db.scalars(select(UsSymbol)).all()}

        self.assertNotIn("FILE CREATION TIME: 0618202608:31", symbols)
        self.assertFalse(any("CREATION" in symbol for symbol in symbols))

    def test_download_failure_records_failed_run(self) -> None:
        def boom(url: str) -> bytes:
            raise RuntimeError("network down")

        with self.session_factory() as db:
            result = SymbolDirectorySyncService().sync_from_nasdaq(db, fetch=boom)

        self.assertEqual(result.status, "failed")
        self.assertIn("network down", result.error_message or "")
        with self.session_factory() as db:
            self.assertEqual(db.scalar(select(UsSymbol).limit(1)), None)


if __name__ == "__main__":
    unittest.main()
