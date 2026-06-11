import re
import xml.etree.ElementTree as ET
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

Record = dict[str, Any]
ParsedFlexData = dict[str, list[Record]]

POSITION_FIELDS = (
    "report_date",
    "account_id",
    "currency",
    "asset_class",
    "symbol",
    "description",
    "conid",
    "quantity",
    "mark_price",
    "position_value",
    "open_price",
    "cost_basis_price",
    "cost_basis_money",
    "unrealized_pnl",
    "side",
    "level_of_detail",
    "open_datetime",
    "holding_period_datetime",
    "originating_order_id",
    "originating_transaction_id",
)
TRADE_FIELDS = (
    "report_date",
    "account_id",
    "currency",
    "asset_class",
    "symbol",
    "description",
    "conid",
    "datetime",
    "trade_date",
    "settle_date",
    "transaction_type",
    "exchange",
    "quantity",
    "trade_price",
    "trade_money",
    "proceeds",
    "taxes",
    "ib_commission",
    "ib_commission_currency",
    "net_cash",
    "open_close_indicator",
    "cost_basis",
    "realized_pnl",
    "mtm_pnl",
    "buy_sell",
    "order_id",
    "transaction_id",
    "ib_execution_id",
    "ib_order_id",
    "orig_order_id",
    "orig_trade_price",
    "orig_trade_date",
    "orig_trade_id",
    "open_datetime",
    "level_of_detail",
)
CASH_REPORT_FIELDS = (
    "report_date",
    "account_id",
    "currency",
    "level_of_detail",
    "from_date",
    "to_date",
    "starting_cash",
    "deposits",
    "withdrawals",
    "deposit_withdrawals",
    "dividends",
    "broker_interest_paid_received",
    "commissions",
    "net_trades_sales",
    "net_trades_purchases",
    "withholding_tax",
    "transaction_tax",
    "fx_translation_gain_loss",
    "other_fees",
    "other_income",
    "other",
    "ending_cash",
    "ending_settled_cash",
)
CASH_TRANSACTION_FIELDS = (
    "report_date",
    "account_id",
    "currency",
    "asset_class",
    "symbol",
    "description",
    "conid",
    "datetime",
    "trade_date",
    "transaction_type",
    "type",
    "code",
    "amount",
    "proceeds",
    "ib_commission",
    "taxes",
    "transaction_id",
    "external_id",
)
NAV_FIELDS = (
    "report_date",
    "account_id",
    "currency",
    "cash",
    "stock",
    "options",
    "funds",
    "dividend_accruals",
    "interest_accruals",
    "broker_interest_accruals_component",
    "margin_financing_charge_accruals",
    "crypto",
    "total",
)

DECIMAL_FIELDS = {
    "quantity",
    "mark_price",
    "position_value",
    "open_price",
    "cost_basis_price",
    "cost_basis_money",
    "unrealized_pnl",
    "trade_price",
    "trade_money",
    "proceeds",
    "taxes",
    "ib_commission",
    "net_cash",
    "cost_basis",
    "realized_pnl",
    "mtm_pnl",
    "orig_trade_price",
    "starting_cash",
    "deposits",
    "withdrawals",
    "deposit_withdrawals",
    "dividends",
    "broker_interest_paid_received",
    "commissions",
    "net_trades_sales",
    "net_trades_purchases",
    "withholding_tax",
    "transaction_tax",
    "fx_translation_gain_loss",
    "other_fees",
    "other_income",
    "other",
    "ending_cash",
    "ending_settled_cash",
    "amount",
    "cash",
    "stock",
    "options",
    "funds",
    "dividend_accruals",
    "interest_accruals",
    "broker_interest_accruals_component",
    "margin_financing_charge_accruals",
    "crypto",
    "total",
}
DATE_FIELDS = {"report_date", "trade_date", "settle_date", "orig_trade_date", "from_date", "to_date"}
DATETIME_FIELDS = {"datetime", "open_datetime", "holding_period_datetime"}
FIELD_ALIASES = {
    "asset_category": "asset_class",
    "position": "quantity",
    "fifo_pnl_unrealized": "unrealized_pnl",
    "fifo_pnl_realized": "realized_pnl",
    "date_time": "datetime",
    "open_date_time": "open_datetime",
    "holding_period_date_time": "holding_period_datetime",
    "settle_date_target": "settle_date",
    "cost": "cost_basis",
    "ib_exec_id": "ib_execution_id",
    "broker_interest": "broker_interest_paid_received",
    "transaction_id": "transaction_id",
}


def parse_flex_xml(xml_path: str | Path) -> ParsedFlexData:
    """Parse an archived IBKR Flex XML document without persistence side effects."""
    root = ET.parse(Path(xml_path)).getroot()

    positions = [
        _parse_record(element, POSITION_FIELDS)
        for element in _records_under(root, "OpenPositions", "OpenPosition")
        if _is_lot_record(element)
    ]
    trades = [
        _parse_record(element, TRADE_FIELDS)
        for element in _records_under(root, "Trades", "Trade")
    ]
    cash_report = [
        _parse_cash_record(element)
        for element in _records_under(root, "CashReport", "CashReportCurrency")
    ]
    cash_transactions = [
        _parse_record(element, CASH_TRANSACTION_FIELDS)
        for element in _records_under(root, "CashTransactions", "CashTransaction")
    ]
    nav_daily = [
        _parse_record(element, NAV_FIELDS)
        for element in _records_under(
            root, "EquitySummaryInBase", "EquitySummaryByReportDateInBase"
        )
    ]

    return {
        "positions_lot": positions,
        "trades": trades,
        "cash_report": cash_report,
        "cash_transactions": cash_transactions,
        "nav_daily": nav_daily,
    }


def normalize_field_name(field_name: str) -> str:
    normalized = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", field_name)
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", normalized).lower()
    return FIELD_ALIASES.get(normalized, normalized)


def _records_under(root: ET.Element, section_tag: str, record_tag: str) -> list[ET.Element]:
    records: list[ET.Element] = []
    for section in root.iter():
        if _local_name(section.tag) != section_tag:
            continue
        records.extend(
            element
            for element in section.iter()
            if element is not section and _local_name(element.tag) == record_tag
        )
    return records


def _is_lot_record(element: ET.Element) -> bool:
    level = element.attrib.get("levelOfDetail", "")
    return level.strip().upper().replace(" ", "_") == "LOT"


def _parse_record(element: ET.Element, fields: tuple[str, ...]) -> Record:
    normalized_attributes = {
        normalize_field_name(key): _empty_to_none(value) for key, value in element.attrib.items()
    }
    return {
        field: _convert_value(field, normalized_attributes.get(field))
        for field in fields
    }


def _parse_cash_record(element: ET.Element) -> Record:
    record = _parse_record(element, CASH_REPORT_FIELDS)
    if record["report_date"] is None:
        record["report_date"] = record["to_date"]
    return record


def _convert_value(field: str, value: str | None) -> Any:
    if value is None:
        return None
    if field in DECIMAL_FIELDS:
        return _parse_decimal(value)
    if field in DATE_FIELDS:
        return _parse_date(value)
    if field in DATETIME_FIELDS:
        return _parse_datetime(value)
    return value


def _empty_to_none(value: str) -> str | None:
    stripped = value.strip()
    return stripped or None


def _parse_decimal(value: str) -> Decimal | None:
    normalized = value.replace(",", "").rstrip("%")
    try:
        return Decimal(normalized)
    except InvalidOperation:
        return None


def _parse_date(value: str) -> date | None:
    for format_string in ("%Y%m%d", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(value, format_string).date()
        except ValueError:
            pass
    return None


def _parse_datetime(value: str) -> datetime | None:
    iso_value = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(iso_value)
    except ValueError:
        pass

    for format_string in (
        "%Y%m%d;%H%M%S",
        "%Y%m%d;%H%M%S %Z",
        "%Y-%m-%d;%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ):
        try:
            return datetime.strptime(value, format_string)
        except ValueError:
            pass
    return None


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]
