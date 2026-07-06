import re
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import CashReport, LotAnalysisDaily, NavDaily, RawFlexReport, Trade
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

    base_currency = _single_value(row.currency for row in nav_rows)
    fx_rates = _fx_rates_to_base(db, base_currency)

    response: list[PortfolioPerformanceDailyResponse] = []
    previous_date: date | None = None
    previous_nav: Decimal | None = None
    for report_date in sorted(nav_rows_by_date):
        rows = nav_rows_by_date[report_date]
        if not rows:
            continue
        nav = _aggregate_nav_daily(report_date, rows)
        current_nav = nav.total
        flows = _external_cash_flows(cash_rows_by_date.get(report_date, []))
        # Daily performance is the change in NAV with external cash flows removed.
        # Buying/selling holdings is NAV-neutral, so trades correctly do not count
        # as performance; only deposits/withdrawals are subtracted out. Foreign-
        # currency flows are converted to the base currency using rates derived
        # from FX-conversion trades; a flow whose currency has no known rate leaves
        # the day's performance unavailable (the flow is still shown natively).
        total_cash_flow_base = Decimal("0")
        has_unconvertible_flow = False
        for currency, amount in flows:
            converted = _convert_flow_to_base(
                amount, currency, report_date, base_currency, fx_rates
            )
            if converted is None:
                has_unconvertible_flow = True
            else:
                total_cash_flow_base += converted
        if current_nav is not None and previous_nav is not None and not has_unconvertible_flow:
            performance_amount = current_nav - previous_nav - total_cash_flow_base
            performance_pct = (
                performance_amount / previous_nav if previous_nav > 0 else None
            )
        else:
            performance_amount = None
            performance_pct = None
        response.append(
            PortfolioPerformanceDailyResponse(
                date=report_date,
                currency=nav.currency,
                nav=current_nav,
                previous_date=previous_date,
                previous_nav=previous_nav,
                external_cash_flow=total_cash_flow_base,
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


_FX_PAIR = re.compile(r"^([A-Z]{3})\.([A-Z]{3})$")


def _fx_rates_to_base(
    db: Session, base_currency: str | None
) -> dict[str, list[tuple[date, Decimal]]]:
    """Per-currency (trade_date, rate-to-base) points derived from IBKR FX
    conversion trades (e.g. ``USD.CNH``).

    IBKR quotes an FX pair as ``BASE.QUOTE`` with ``trade_price`` in units of the
    quote currency per one base unit, so ``USD.CNH`` at 6.80 means 1 USD = 6.80
    CNH and the CNH->USD rate is ``1 / 6.80``. These rates let us express
    foreign-currency cash flows in the NAV base currency.
    """
    if not base_currency:
        return {}

    base = base_currency.upper()
    rows = db.scalars(
        select(Trade).where(Trade.symbol.is_not(None), Trade.trade_price.is_not(None))
    ).all()
    rates: dict[str, list[tuple[date, Decimal]]] = {}
    for row in rows:
        match = _FX_PAIR.match((row.symbol or "").upper())
        if match is None:
            continue
        left, right = match.group(1), match.group(2)
        price = row.trade_price
        on_date = row.trade_date or row.report_date
        if price is None or price == 0 or on_date is None:
            continue
        if left == base and right != base:
            foreign, rate = right, Decimal(1) / price
        elif right == base and left != base:
            foreign, rate = left, price
        else:
            continue
        rates.setdefault(foreign, []).append((on_date, rate))
    for points in rates.values():
        points.sort(key=lambda item: item[0])
    return rates


def _convert_flow_to_base(
    amount: Decimal,
    currency: str | None,
    on_date: date,
    base_currency: str | None,
    fx_rates: dict[str, list[tuple[date, Decimal]]],
) -> Decimal | None:
    """Convert a cash flow to the base currency, or None if no rate is known."""
    if base_currency is None:
        return amount if currency is None else None
    if currency is None or currency.upper() == base_currency.upper():
        return amount

    points = fx_rates.get(currency.upper())
    if not points:
        return None

    # Use the most recent rate on or before the flow date; fall back to the
    # earliest known rate. FX rates move little day to day, so this is safe.
    rate = points[0][1]
    for point_date, point_rate in points:
        if point_date <= on_date:
            rate = point_rate
        else:
            break
    return amount * rate


def _validate_date_range(start_date: date | None, end_date: date | None) -> None:
    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must not be after end_date")
