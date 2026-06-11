from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import LotAnalysisDaily, PositionLot
from app.schemas import CurrentPositionResponse, LotAnalysisResponse, PositionLotResponse

router = APIRouter(prefix="/positions", tags=["positions"])


@router.get("/current", response_model=list[CurrentPositionResponse])
def get_current_positions(db: Session = Depends(get_db)) -> list[CurrentPositionResponse]:
    latest_date, latest_raw_flex_report_id = _latest_report_scope(db, LotAnalysisDaily)
    if latest_raw_flex_report_id is None:
        return []
    analyses = list(
        db.scalars(
            select(LotAnalysisDaily)
            .where(LotAnalysisDaily.report_date == latest_date)
            .where(LotAnalysisDaily.raw_flex_report_id == latest_raw_flex_report_id)
            .order_by(LotAnalysisDaily.symbol.asc(), LotAnalysisDaily.conid.asc())
        ).all()
    )
    market_values = [_multiply(row.current_price, row.total_quantity) for row in analyses]
    total_market_value = _sum_decimal(market_values)
    return [
        CurrentPositionResponse(
            symbol=row.symbol,
            conid=row.conid,
            total_quantity=row.total_quantity,
            current_price=row.current_price,
            avg_cost=row.avg_cost,
            market_value=market_value,
            unrealized_pnl=row.unrealized_pnl,
            unrealized_pnl_pct=_divide(row.unrealized_pnl, row.total_cost_basis_money),
            weight_pct=_divide(market_value, total_market_value),
        )
        for row, market_value in zip(analyses, market_values, strict=True)
    ]


@router.get("/lots", response_model=list[PositionLotResponse])
def get_position_lots(
    symbol: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[PositionLot]:
    latest_date, latest_raw_flex_report_id = _latest_report_scope(db, PositionLot)
    if latest_raw_flex_report_id is None:
        return []
    statement = (
        select(PositionLot)
        .where(PositionLot.report_date == latest_date)
        .where(PositionLot.raw_flex_report_id == latest_raw_flex_report_id)
    )
    if symbol is not None:
        statement = statement.where(PositionLot.symbol == symbol)
    return list(
        db.scalars(
            statement.order_by(PositionLot.symbol.asc(), PositionLot.open_datetime.asc())
        ).all()
    )


@router.get("/lots/analysis", response_model=list[LotAnalysisResponse])
def get_lot_analysis(db: Session = Depends(get_db)) -> list[LotAnalysisDaily]:
    latest_date, latest_raw_flex_report_id = _latest_report_scope(db, LotAnalysisDaily)
    if latest_raw_flex_report_id is None:
        return []
    return list(
        db.scalars(
            select(LotAnalysisDaily)
            .where(LotAnalysisDaily.report_date == latest_date)
            .where(LotAnalysisDaily.raw_flex_report_id == latest_raw_flex_report_id)
            .order_by(LotAnalysisDaily.symbol.asc(), LotAnalysisDaily.conid.asc())
        ).all()
    )


def _latest_report_scope(db: Session, model) -> tuple[object | None, int | None]:
    latest_date = db.scalar(select(func.max(model.report_date)))
    if latest_date is None:
        return None, None
    latest_raw_flex_report_id = db.scalar(
        select(func.max(model.raw_flex_report_id)).where(model.report_date == latest_date)
    )
    return latest_date, latest_raw_flex_report_id


def _multiply(left: Decimal | None, right: Decimal | None) -> Decimal | None:
    return left * right if left is not None and right is not None else None


def _sum_decimal(values: list[Decimal | None]) -> Decimal | None:
    present = [value for value in values if value is not None]
    return sum(present, Decimal("0")) if present else None


def _divide(numerator: Decimal | None, denominator: Decimal | None) -> Decimal | None:
    if numerator is None or denominator in (None, Decimal("0")):
        return None
    return numerator / denominator
