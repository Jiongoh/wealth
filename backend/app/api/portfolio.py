from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import CashReport, LotAnalysisDaily, NavDaily, RawFlexReport
from app.schemas import (
    ExternalCashFlow,
    NavDailyResponse,
    PortfolioPerformanceDailyResponse,
    PortfolioSummaryResponse,
)

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


@router.get("/summary", response_model=PortfolioSummaryResponse | None)
def get_portfolio_summary(db: Session = Depends(get_db)) -> PortfolioSummaryResponse | None:
    latest_nav_reports = _latest_raw_report_ids_by_date(db, NavDaily)
    if not latest_nav_reports:
        return None
    latest_date = max(latest_nav_reports)
    latest_raw_flex_report_id = latest_nav_reports[latest_date]

    rows = _rows_for_report_date(db, NavDaily, latest_date, latest_raw_flex_report_id)
    unrealized_rows = db.scalars(
        select(LotAnalysisDaily.unrealized_pnl).where(
            LotAnalysisDaily.report_date == latest_date,
            LotAnalysisDaily.raw_flex_report_id == latest_raw_flex_report_id,
        )
    ).all()
    currencies = {row.currency for row in rows if row.currency is not None}
    return PortfolioSummaryResponse(
        report_date=latest_date,
        total_nav=_sum_decimal(row.total for row in rows),
        cash=_sum_decimal(row.cash for row in rows),
        stock=_sum_decimal(row.stock for row in rows),
        unrealized_pnl=_sum_decimal(unrealized_rows),
        currency=next(iter(currencies)) if len(currencies) == 1 else None,
    )


@router.get("/nav/history", response_model=list[NavDailyResponse])
def get_nav_history(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[NavDailyResponse]:
    _validate_date_range(start_date, end_date)
    latest_reports = _latest_raw_report_ids_by_date(
        db,
        NavDaily,
        start_date=start_date,
        end_date=end_date,
    )
    if not latest_reports:
        return []

    rows = list(
        db.scalars(
            select(NavDaily)
            .where(NavDaily.raw_flex_report_id.in_(set(latest_reports.values())))
            .order_by(NavDaily.report_date.asc(), NavDaily.account_id.asc())
        ).all()
    )
    rows_by_date = {
        report_date: [
            row
            for row in rows
            if row.report_date == report_date
            and row.raw_flex_report_id == raw_flex_report_id
        ]
        for report_date, raw_flex_report_id in latest_reports.items()
    }
    return [
        _aggregate_nav_daily(report_date, rows_by_date[report_date])
        for report_date in sorted(rows_by_date)
        if rows_by_date[report_date]
    ]


@router.get("/performance/daily", response_model=list[PortfolioPerformanceDailyResponse])
def get_daily_performance(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[PortfolioPerformanceDailyResponse]:
    _validate_date_range(start_date, end_date)
    latest_nav_reports = _latest_raw_report_ids_by_date(
        db,
        NavDaily,
        start_date=start_date,
        end_date=end_date,
    )
    if not latest_nav_reports:
        return []

    nav_rows = list(
        db.scalars(
            select(NavDaily)
            .where(NavDaily.raw_flex_report_id.in_(set(latest_nav_reports.values())))
            .order_by(NavDaily.report_date.asc(), NavDaily.account_id.asc())
        ).all()
    )
    nav_rows_by_date = {
        report_date: [
            row
            for row in nav_rows
            if row.report_date == report_date
            and row.raw_flex_report_id == raw_flex_report_id
        ]
        for report_date, raw_flex_report_id in latest_nav_reports.items()
    }

    latest_cash_reports = _latest_raw_report_ids_by_date(
        db,
        CashReport,
        start_date=start_date,
        end_date=end_date,
    )
    cash_rows = (
        list(
            db.scalars(
                select(CashReport)
                .where(CashReport.raw_flex_report_id.in_(set(latest_cash_reports.values())))
                .order_by(CashReport.report_date.asc(), CashReport.account_id.asc())
            ).all()
        )
        if latest_cash_reports
        else []
    )
    cash_rows_by_date = {
        report_date: [
            row
            for row in cash_rows
            if row.report_date == report_date
            and row.raw_flex_report_id == raw_flex_report_id
        ]
        for report_date, raw_flex_report_id in latest_cash_reports.items()
    }

    response: list[PortfolioPerformanceDailyResponse] = []
    previous_date: date | None = None
    previous_nav: Decimal | None = None
    previous_stock: Decimal | None = None
    for report_date in sorted(nav_rows_by_date):
        rows = nav_rows_by_date[report_date]
        if not rows:
            continue
        nav = _aggregate_nav_daily(report_date, rows)
        current_nav = nav.total
        current_stock = nav.stock
        flows = _external_cash_flows(cash_rows_by_date.get(report_date, []))
        # External cash flow (deposits/withdrawals) must not count as performance.
        # Daily performance is the change in stock (market) value alone; cash and
        # cash flows are excluded entirely. Flows are still surfaced for display
        # in native currency (no FX conversion) via `external_cash_flows`.
        base_cash_flow = sum(
            (amount for currency, amount in flows if currency == nav.currency),
            Decimal("0"),
        )
        performance_amount = (
            current_stock - previous_stock
            if current_stock is not None and previous_stock is not None
            else None
        )
        performance_pct = (
            performance_amount / previous_stock
            if performance_amount is not None and previous_stock is not None and previous_stock > 0
            else None
        )
        response.append(
            PortfolioPerformanceDailyResponse(
                date=report_date,
                currency=nav.currency,
                nav=current_nav,
                previous_date=previous_date,
                previous_nav=previous_nav,
                external_cash_flow=base_cash_flow,
                external_cash_flows=[
                    ExternalCashFlow(currency=currency, amount=amount)
                    for currency, amount in flows
                ],
                performance_amount=performance_amount,
                performance_pct=performance_pct,
            )
        )
        if current_nav is not None:
            previous_date = report_date
            previous_nav = current_nav
            previous_stock = current_stock

    return response


def _sum_decimal(values) -> Decimal | None:
    present = [value for value in values if value is not None]
    return sum(present, Decimal("0")) if present else None


def _latest_raw_report_ids_by_date(
    db: Session,
    model,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[date, int]:
    statement = (
        select(model.report_date, model.raw_flex_report_id, RawFlexReport.downloaded_at)
        .join(RawFlexReport, RawFlexReport.id == model.raw_flex_report_id)
        .where(model.report_date.is_not(None), RawFlexReport.status == "parsed")
    )
    if start_date is not None:
        statement = statement.where(model.report_date >= start_date)
    if end_date is not None:
        statement = statement.where(model.report_date <= end_date)

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


def _rows_for_report_date(
    db: Session,
    model,
    report_date: date,
    raw_flex_report_id: int,
):
    return list(
        db.scalars(
            select(model).where(
                model.report_date == report_date,
                model.raw_flex_report_id == raw_flex_report_id,
            )
        ).all()
    )


def _single_value(values) -> object | None:
    present = {value for value in values if value is not None}
    return next(iter(present)) if len(present) == 1 else None


def _aggregate_nav_daily(report_date: date, rows: list[NavDaily]) -> NavDailyResponse:
    return NavDailyResponse(
        report_date=report_date,
        account_id=_single_value(row.account_id for row in rows),
        currency=_single_value(row.currency for row in rows),
        cash=_sum_decimal(row.cash for row in rows),
        stock=_sum_decimal(row.stock for row in rows),
        options=_sum_decimal(row.options for row in rows),
        funds=_sum_decimal(row.funds for row in rows),
        dividend_accruals=_sum_decimal(row.dividend_accruals for row in rows),
        interest_accruals=_sum_decimal(row.interest_accruals for row in rows),
        broker_interest_accruals_component=_sum_decimal(
            row.broker_interest_accruals_component for row in rows
        ),
        margin_financing_charge_accruals=_sum_decimal(
            row.margin_financing_charge_accruals for row in rows
        ),
        crypto=_sum_decimal(row.crypto for row in rows),
        total=_sum_decimal(row.total for row in rows),
    )


def _row_cash_flow(row: CashReport) -> Decimal:
    if row.deposit_withdrawals is not None:
        return row.deposit_withdrawals

    deposits = row.deposits or Decimal("0")
    withdrawals = row.withdrawals or Decimal("0")
    # IBKR withdrawal sign can vary by report configuration. Subtracting abs()
    # prevents both positive and negative withdrawal fields from being counted
    # as investment performance.
    return deposits - abs(withdrawals)


def _external_cash_flows(rows: list[CashReport]) -> list[tuple[str | None, Decimal]]:
    """Net external cash flow per currency (native units, non-zero only).

    Cash reports are denominated per currency; they are intentionally not
    summed across currencies (the NAV they are compared against is in the
    account base currency).
    """
    totals: dict[str | None, Decimal] = {}
    for row in rows:
        flow = _row_cash_flow(row)
        if flow == 0:
            continue
        totals[row.currency] = totals.get(row.currency, Decimal("0")) + flow
    return [(currency, amount) for currency, amount in totals.items() if amount != 0]


def _validate_date_range(start_date: date | None, end_date: date | None) -> None:
    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must not be after end_date")
