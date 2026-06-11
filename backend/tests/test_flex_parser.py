import unittest
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from app.services.flex_parser import normalize_field_name, parse_flex_xml

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "minimal_flex_statement.xml"


class FlexParserTest(unittest.TestCase):
    def test_parses_only_open_position_lot_records_and_typed_values(self) -> None:
        parsed = parse_flex_xml(FIXTURE_PATH)

        self.assertEqual(len(parsed["positions_lot"]), 1)
        position = parsed["positions_lot"][0]
        self.assertEqual(position["level_of_detail"], "LOT")
        self.assertEqual(position["asset_class"], "STK")
        self.assertEqual(position["quantity"], Decimal("2.5000000000"))
        self.assertEqual(position["unrealized_pnl"], Decimal("10.50"))
        self.assertEqual(position["report_date"], date(2026, 1, 31))
        self.assertEqual(position["open_datetime"], datetime(2026, 1, 2, 9, 30))
        self.assertIsNone(position["description"])
        self.assertIsNone(position["open_price"])

    def test_preserves_trade_detail_rows_and_converts_optional_values(self) -> None:
        parsed = parse_flex_xml(FIXTURE_PATH)

        self.assertEqual(
            [trade["level_of_detail"] for trade in parsed["trades"]],
            ["EXECUTION", "CLOSED_LOT", "ORDER"],
        )
        self.assertEqual(parsed["trades"][0]["trade_price"], Decimal("18.50"))
        self.assertEqual(parsed["trades"][0]["trade_date"], date(2026, 1, 10))
        self.assertEqual(parsed["trades"][0]["datetime"], datetime(2026, 1, 10, 10, 15))
        self.assertEqual(parsed["trades"][0]["symbol"], "DEMO")
        self.assertEqual(parsed["trades"][0]["conid"], "1001")
        self.assertEqual(parsed["trades"][0]["asset_class"], "STK")
        self.assertIsNone(parsed["trades"][0]["realized_pnl"])
        self.assertIsNone(parsed["trades"][0]["currency"])
        self.assertEqual(parsed["trades"][1]["cost_basis"], Decimal("18.50"))
        self.assertEqual(parsed["trades"][1]["realized_pnl"], Decimal("1.25"))

    def test_parses_cash_and_nav_sections_with_missing_fields(self) -> None:
        parsed = parse_flex_xml(FIXTURE_PATH)

        cash = parsed["cash_report"][0]
        nav = parsed["nav_daily"][0]
        self.assertEqual(cash["report_date"], date(2026, 1, 31))
        self.assertEqual(cash["ending_cash"], Decimal("125.50"))
        self.assertIsNone(cash["broker_interest_paid_received"])
        self.assertIsNone(cash["withdrawals"])
        self.assertEqual(nav["total"], Decimal("176.125"))
        self.assertIsNone(nav["crypto"])

    def test_normalizes_ibkr_acronym_and_camel_case_field_names(self) -> None:
        self.assertEqual(normalize_field_name("originatingOrderID"), "originating_order_id")
        self.assertEqual(normalize_field_name("ibExecID"), "ib_execution_id")
        self.assertEqual(normalize_field_name("fifoPnlUnrealized"), "unrealized_pnl")


if __name__ == "__main__":
    unittest.main()
