from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import CashActivity, CashReport, RawFlexReport, Trade
from app.schemas import (
    CashActivityListResponse,
    CashBalancePointResponse,
    CashBalanceTimeseriesResponse,
    CashReportResponse,
    TradeListResponse,
)
from app.services.trade_classifier import is_fx_conversion_trade

router = APIRouter(tags=["activity"])


@router.get("/trades", response_model=TradeListResponse)
def get_trades(
    symbol: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=5000),
    db: Session = Depends(get_db),
) -> TradeListResponse:
    _validate_date_range(start_date, end_date)
    symbol_filter = symbol.strip().upper() if symbol else ""
    statement = select(Trade)
    if symbol_filter:
        statement = statement.where(func.upper(Trade.symbol) == symbol_filter)

    rows = list(db.scalars(statement).all())
    filtered_rows = [
        row
        for row in rows
        if not is_fx_conversion_trade(row)
        and _trade_matches_date_range(row, start_date=start_date, end_date=end_date)
    ]
    filtered_rows.sort(key=_trade_sort_key, reverse=True)

    total_count = len(filtered_rows)
    buy_count = sum(1 for row in filtered_rows if (row.buy_sell or "").upper() == "BUY")
    sell_count = sum(1 for row in filtered_rows if (row.buy_sell or "").upper() == "SELL")
    items = filtered_rows[:limit] if limit is not None else filtered_rows

    return TradeListResponse(
        items=items,
        total_count=total_count,
        buy_count=buy_count,
        sell_count=sell_count,
        symbol_filter=symbol_filter or "All",
    )


@router.get("/cash/history", response_model=list[CashReportResponse])
def get_cash_history(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    currency: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[CashReport]:
    _validate_date_range(start_date, end_date)
    latest_reports = _latest_raw_report_ids_by_date(
        db,
        start_date=start_date,
        end_date=end_date,
    )
    if not latest_reports:
        return []
    statement = select(CashReport).where(
        CashReport.raw_flex_report_id.in_(set(latest_reports.values()))
    )
    if currency is not None:
        statement = statement.where(CashReport.currency == currency.upper())
    rows = list(
        db.scalars(
            statement.order_by(CashReport.report_date.asc(), CashReport.currency.asc())
        ).all()
    )
    return [
        row
        for row in rows
        if row.report_date is not None
        and latest_reports.get(row.report_date) == row.raw_flex_report_id
    ]


@router.get("/cash/balances/timeseries", response_model=CashBalanceTimeseriesResponse)
def get_cash_balance_timeseries(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    currency: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> CashBalanceTimeseriesResponse:
    _validate_date_range(start_date, end_date)
    latest_reports = _latest_raw_report_ids_by_date(
        db,
        start_date=start_date,
        end_date=end_date,
    )
    if not latest_reports:
        return CashBalanceTimeseriesResponse(items=[], currencies=[])

    currency_filter = currency.strip().upper() if currency and currency.strip() else None
    statement = select(CashReport).where(
        CashReport.raw_flex_report_id.in_(set(latest_reports.values())),
        CashReport.report_date.is_not(None),
        CashReport.currency.is_not(None),
        CashReport.ending_cash.is_not(None),
    )
    if currency_filter is not None:
        statement = statement.where(func.upper(CashReport.currency) == currency_filter)

    rows = [
        row
        for row in db.scalars(
            statement.order_by(CashReport.report_date.asc(), CashReport.currency.asc())
        ).all()
        if row.report_date is not None
        and row.currency is not None
        and latest_reports.get(row.report_date) == row.raw_flex_report_id
    ]

    activity_currencies = _cash_activity_currencies(
        db,
        start_date=start_date,
        end_date=end_date,
        currency=currency_filter,
    )
    currencies_with_balance = {
        row.currency.upper()
        for row in rows
        if row.currency is not None and row.ending_cash is not None and row.ending_cash != 0
    }
    visible_currencies = currencies_with_balance | activity_currencies

    items = [
        CashBalancePointResponse(
            date=row.report_date,
            currency=row.currency.upper(),
            balance=row.ending_cash,
        )
        for row in rows
        if row.currency.upper() in visible_currencies
    ]
    currencies = sorted({item.currency for item in items})

    return CashBalanceTimeseriesResponse(items=items, currencies=currencies)


@router.get("/cash/activities", response_model=CashActivityListResponse)
def get_cash_activities(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    currency: str | None = Query(default=None),
    activity_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> CashActivityListResponse:
    _validate_date_range(start_date, end_date)

    statement = select(CashActivity)
    if start_date is not None:
        statement = statement.where(CashActivity.activity_date >= start_date)
    if end_date is not None:
        statement = statement.where(CashActivity.activity_date <= end_date)
    if currency is not None and currency.strip():
        statement = statement.where(CashActivity.currency == currency.strip().upper())
    if activity_type is not None and activity_type.strip():
        statement = statement.where(CashActivity.activity_type == activity_type.strip().upper())

    rows = [
        row
        for row in db.scalars(
            statement.order_by(
                CashActivity.activity_date.desc(),
                CashActivity.activity_datetime.desc(),
                CashActivity.id.desc(),
            )
        ).all()
        if row.amount is not None and row.amount != 0
    ]
    by_type = {
        activity: 0
        for activity in (
            "DEPOSIT",
            "WITHDRAWAL",
            "FX_CONVERSION",
            "DIVIDEND",
            "INTEREST",
            "COMMISSION",
            "TAX",
            "FEE",
            "OTHER",
        )
    }
    for row in rows:
        by_type[row.activity_type or "OTHER"] = by_type.get(row.activity_type or "OTHER", 0) + 1

    return CashActivityListResponse(items=rows, total_count=len(rows), by_type=by_type)


def _cash_activity_currencies(
    db: Session,
    *,
    start_date: date | None,
    end_date: date | None,
    currency: str | None,
) -> set[str]:
    statement = select(CashActivity.currency).where(
        CashActivity.currency.is_not(None),
        CashActivity.amount.is_not(None),
        CashActivity.amount != 0,
    )
    if start_date is not None:
        statement = statement.where(CashActivity.activity_date >= start_date)
    if end_date is not None:
        statement = statement.where(CashActivity.activity_date <= end_date)
    if currency is not None:
        statement = statement.where(func.upper(CashActivity.currency) == currency)

    return {
        row_currency.upper()
        for (row_currency,) in db.execute(statement).all()
        if row_currency is not None
    }


def _latest_raw_report_ids_by_date(
    db: Session,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[date, int]:
    statement = (
        select(CashReport.report_date, CashReport.raw_flex_report_id, RawFlexReport.downloaded_at)
        .join(RawFlexReport, RawFlexReport.id == CashReport.raw_flex_report_id)
        .where(CashReport.report_date.is_not(None), RawFlexReport.status == "parsed")
    )
    if start_date is not None:
        statement = statement.where(CashReport.report_date >= start_date)
    if end_date is not None:
        statement = statement.where(CashReport.report_date <= end_date)

    latest: dict[date, tuple[object, int]] = {}
    for report_date, raw_flex_report_id, downloaded_at in db.execute(statement).all():
        if report_date is None:
            continue
        current = latest.get(report_date)
        candidate = (downloaded_at, raw_flex_report_id)
        if current is None or candidate > current:
            latest[report_date] = candidate

    return {
        report_date: raw_flex_report_id
        for report_date, (_, raw_flex_report_id) in latest.items()
    }


def _validate_date_range(start_date: date | None, end_date: date | None) -> None:
    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must not be after end_date")


def _trade_effective_date(trade: Trade) -> date | None:
    if trade.trade_date is not None:
        return trade.trade_date
    if trade.datetime is not None:
        return trade.datetime.date()
    return trade.report_date


def _trade_matches_date_range(
    trade: Trade,
    *,
    start_date: date | None,
    end_date: date | None,
) -> bool:
    effective_date = _trade_effective_date(trade)
    if start_date is not None and (effective_date is None or effective_date < start_date):
        return False
    if end_date is not None and (effective_date is None or effective_date > end_date):
        return False
    return True


def _trade_sort_key(trade: Trade) -> tuple[date, datetime]:
    effective_date = _trade_effective_date(trade) or date.min
    effective_datetime = trade.datetime or datetime.min
    return effective_date, effective_datetime
