from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.business_data import (
    CashActivity,
    CashReport,
    LotAnalysisDaily,
    NavDaily,
    PositionLot,
    Trade,
)
from app.models.raw_flex_report import RawFlexReport
from app.services.flex_parser import parse_flex_xml
from app.services.lot_analyzer import LotAnalyzer
from app.services.trade_classifier import is_fx_conversion_record


class IngestionError(Exception):
    pass


@dataclass(frozen=True)
class IngestionResult:
    positions_lot: int
    trades: int
    cash_report: int
    cash_activities: int
    nav_daily: int
    lot_analysis_daily: int


class IngestionService:
    def __init__(self, analysis_service: LotAnalyzer | None = None) -> None:
        self.analysis_service = analysis_service or LotAnalyzer()

    def ingest_report(self, db: Session, raw_flex_report_id: int) -> IngestionResult:
        try:
            report = db.get(RawFlexReport, raw_flex_report_id)
            if report is None:
                raise IngestionError(f"Raw Flex report not found: id={raw_flex_report_id}")
            parsed = parse_flex_xml(Path(report.xml_path))

            self._delete_existing_rows(db, raw_flex_report_id)
            db.add_all(
                PositionLot(**record, raw_flex_report_id=raw_flex_report_id)
                for record in parsed["positions_lot"]
            )
            db.add_all(
                Trade(**record, raw_flex_report_id=raw_flex_report_id)
                for record in parsed["trades"]
            )
            db.add_all(
                CashReport(**record, raw_flex_report_id=raw_flex_report_id)
                for record in parsed["cash_report"]
            )
            db.add_all(
                NavDaily(**record, raw_flex_report_id=raw_flex_report_id)
                for record in parsed["nav_daily"]
            )
            cash_activities = _cash_activity_records(parsed)
            db.add_all(
                CashActivity(**record, raw_flex_report_id=raw_flex_report_id)
                for record in cash_activities
            )
            db.flush()

            analysis_count = self.analysis_service.rebuild(db, raw_flex_report_id)
            report.report_date = _report_date(parsed)
            report.status = "parsed"
            report.error_message = None
            db.commit()
            return IngestionResult(
                positions_lot=len(parsed["positions_lot"]),
                trades=len(parsed["trades"]),
                cash_report=len(parsed["cash_report"]),
                cash_activities=len(cash_activities),
                nav_daily=len(parsed["nav_daily"]),
                lot_analysis_daily=analysis_count,
            )
        except Exception as exc:
            db.rollback()
            report = db.get(RawFlexReport, raw_flex_report_id)
            if report is not None:
                report.status = "failed"
                report.error_message = _error_message(exc)
                db.commit()
            if isinstance(exc, IngestionError):
                raise
            raise IngestionError(_error_message(exc)) from exc

    def _delete_existing_rows(self, db: Session, raw_flex_report_id: int) -> None:
        for model in (LotAnalysisDaily, CashActivity, PositionLot, Trade, CashReport, NavDaily):
            db.execute(delete(model).where(model.raw_flex_report_id == raw_flex_report_id))

    def reingest_all(self, db: Session) -> dict[str, int]:
        """Re-run ingestion for every archived Flex report.

        `ingest_report` deletes and re-inserts each report's rows, so this lets
        already-stored data pick up classifier changes without re-downloading
        anything from IBKR. Reports whose archived XML is missing are counted as
        failures and skipped; the rest are unaffected.
        """
        report_ids = list(db.scalars(select(RawFlexReport.id).order_by(RawFlexReport.id.asc())))
        succeeded = 0
        failed = 0
        for report_id in report_ids:
            try:
                self.ingest_report(db, report_id)
                succeeded += 1
            except IngestionError:
                failed += 1
        return {"total": len(report_ids), "succeeded": succeeded, "failed": failed}


def _report_date(parsed: dict[str, list[dict]]) -> object | None:
    for section in ("nav_daily", "positions_lot", "trades", "cash_report"):
        for record in parsed[section]:
            if record.get("report_date") is not None:
                return record["report_date"]
    return None


def _error_message(exc: Exception) -> str:
    message = str(exc).strip()
    return f"Flex XML ingestion failed: {message}" if message else "Flex XML ingestion failed"


def _cash_activity_records(parsed: dict[str, list[dict]]) -> list[dict]:
    records: list[dict] = []
    for record in parsed.get("cash_transactions", []):
        activity = _activity_from_cash_transaction(record)
        if activity is not None:
            records.append(activity)
    for record in parsed.get("trades", []):
        activity = _activity_from_trade(record)
        if activity is not None:
            records.append(activity)
    for record in parsed.get("cash_report", []):
        records.extend(_activities_from_cash_report(record))
    return records


def _activity_from_cash_transaction(record: dict) -> dict | None:
    amount = _first_decimal(
        record.get("amount"),
        record.get("proceeds"),
        record.get("ib_commission"),
        record.get("taxes"),
    )
    if amount is None or amount == 0:
        return None
    activity_type = _classify_cash_transaction(record, amount)
    activity_datetime = record.get("datetime")
    return {
        "report_date": record.get("report_date"),
        "activity_date": _activity_date(record.get("trade_date"), activity_datetime, record.get("report_date")),
        "activity_datetime": activity_datetime,
        "account_id": record.get("account_id"),
        "currency": _upper_or_none(record.get("currency")),
        "amount": amount,
        "activity_type": activity_type,
        "description": record.get("description") or activity_type.replace("_", " ").title(),
        "source_section": "CASH_TRANSACTIONS",
        "symbol": record.get("symbol"),
        "fx_pair": _fx_pair(record.get("symbol")) if activity_type == "FX_CONVERSION" else None,
        "related_trade_id": None,
        "external_id": record.get("transaction_id") or record.get("external_id") or _fallback_external_id(record),
    }


def _activity_from_trade(record: dict) -> dict | None:
    if not is_fx_conversion_record(record):
        return None
    amount = _first_nonzero_decimal(record.get("net_cash"), record.get("proceeds"), record.get("trade_money"))
    if amount is None or amount == 0:
        return None
    activity_datetime = record.get("datetime")
    symbol = record.get("symbol")
    return {
        "report_date": record.get("report_date"),
        "activity_date": _activity_date(record.get("trade_date"), activity_datetime, record.get("report_date")),
        "activity_datetime": activity_datetime,
        "account_id": record.get("account_id"),
        "currency": _upper_or_none(record.get("currency")),
        "amount": amount,
        "activity_type": "FX_CONVERSION",
        "description": _fx_conversion_description(record, amount),
        "source_section": "TRADES",
        "symbol": symbol,
        "fx_pair": _fx_pair(symbol),
        "related_trade_id": record.get("transaction_id") or record.get("ib_execution_id"),
        "external_id": record.get("transaction_id")
        or record.get("ib_execution_id")
        or record.get("order_id")
        or _fallback_external_id(record),
    }


def _activities_from_cash_report(record: dict) -> list[dict]:
    # CashReport is a period summary, not a balance feed for the Cash Activity table.
    # Only non-zero movement fields are emitted as a fallback when Flex Query does not
    # include CashTransactions / Deposits & Withdrawals detail.
    # `activity_type = None` marks IBKR's combined "Deposits/Withdrawals" line:
    # it lumps both directions into one signed field, so resolve it to
    # DEPOSIT/WITHDRAWAL by the amount sign rather than labelling it OTHER.
    field_map = (
        ("deposits", "DEPOSIT", "Cash report deposits"),
        ("withdrawals", "WITHDRAWAL", "Cash report withdrawals"),
        ("deposit_withdrawals", None, None),
        ("dividends", "DIVIDEND", "Cash report dividends"),
        ("broker_interest_paid_received", "INTEREST", "Cash report broker interest"),
        ("commissions", "COMMISSION", "Cash report commissions"),
        ("withholding_tax", "TAX", "Cash report withholding tax"),
        ("transaction_tax", "TAX", "Cash report transaction tax"),
        ("other_fees", "FEE", "Cash report other fees"),
        ("other_income", "OTHER", "Cash report other income"),
        ("other", "OTHER", "Cash report other movement"),
    )
    activities: list[dict] = []
    for field, activity_type, description in field_map:
        amount = _first_decimal(record.get(field))
        if amount is None or amount == 0:
            continue
        if activity_type is None:
            resolved_type = "DEPOSIT" if amount > 0 else "WITHDRAWAL"
            resolved_description = "Cash report deposit" if amount > 0 else "Cash report withdrawal"
        else:
            resolved_type = activity_type
            resolved_description = description
        activities.append(
            {
                "report_date": record.get("report_date"),
                "activity_date": record.get("report_date") or record.get("to_date"),
                "activity_datetime": None,
                "account_id": record.get("account_id"),
                "currency": _upper_or_none(record.get("currency")),
                "amount": amount,
                "activity_type": resolved_type,
                "description": resolved_description,
                "source_section": "CASH_REPORT_SUMMARY",
                "symbol": None,
                "fx_pair": None,
                "related_trade_id": None,
                "external_id": f"{record.get('account_id')}-{record.get('currency')}-{record.get('report_date')}-{field}",
            }
        )
    return activities


def _classify_cash_transaction(record: dict, amount: Decimal) -> str:
    text = " ".join(
        str(record.get(field) or "")
        for field in ("transaction_type", "type", "code", "description", "asset_class", "symbol")
    ).upper()
    if is_fx_conversion_record(record) or "FOREX" in text or "FX" in text:
        return "FX_CONVERSION"
    if "DIVIDEND" in text:
        return "DIVIDEND"
    if "INTEREST" in text:
        return "INTEREST"
    if "COMMISSION" in text:
        return "COMMISSION"
    if "WITHHOLD" in text or " TAX" in f" {text}" or text.endswith("TAX"):
        return "TAX"
    if "FEE" in text:
        return "FEE"
    if "DEPOSIT" in text or "ADD FUND" in text or "FUNDS RECEIVED" in text:
        return "DEPOSIT"
    if "WITHDRAW" in text:
        return "WITHDRAWAL"
    if amount > 0:
        return "DEPOSIT"
    return "WITHDRAWAL"


def _activity_date(*values: object) -> date | None:
    for value in values:
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
    return None


def _first_decimal(*values: object) -> Decimal | None:
    for value in values:
        if isinstance(value, Decimal):
            return value
        if value is not None:
            try:
                return Decimal(str(value))
            except Exception:
                continue
    return None


def _first_nonzero_decimal(*values: object) -> Decimal | None:
    fallback = _first_decimal(*values)
    for value in values:
        decimal_value = _first_decimal(value)
        if decimal_value is not None and decimal_value != 0:
            return decimal_value
    return fallback


def _upper_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text.upper() if text else None


def _fx_pair(value: object) -> str | None:
    text = _upper_or_none(value)
    return text if text and "." in text else None


def _fx_conversion_description(record: dict, amount: Decimal) -> str:
    pair = _fx_pair(record.get("symbol"))
    quantity = _first_nonzero_decimal(record.get("quantity"))
    if not pair or quantity is None:
        return f"{pair} auto FX conversion" if pair else "Auto FX conversion"

    base_currency, quote_currency = pair.split(".", 1)
    cash_currency = _upper_or_none(record.get("currency")) or quote_currency
    cash_amount = _format_activity_money(cash_currency, abs(amount))
    base_amount = _format_activity_money(base_currency, abs(quantity))
    if str(record.get("buy_sell") or "").upper() == "SELL":
        return f"{base_amount} \u2192 {cash_amount} auto FX conversion"
    return f"{cash_amount} \u2192 {base_amount} auto FX conversion"


def _format_activity_money(currency: str, value: Decimal) -> str:
    return f"{currency} ${value:,.2f}"


def _fallback_external_id(record: dict) -> str:
    parts = [
        record.get("account_id"),
        record.get("symbol"),
        record.get("currency"),
        record.get("datetime"),
        record.get("trade_date"),
        record.get("amount"),
        record.get("net_cash"),
    ]
    return "|".join(str(part) for part in parts if part is not None)
