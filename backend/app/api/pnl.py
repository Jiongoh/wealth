from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import (
    RealizedPnlBySymbolResponse,
    RealizedPnlDailyResponse,
    RealizedPnlSummaryResponse,
)
from app.services.realized_pnl import RealizedPnlService

router = APIRouter(prefix="/pnl", tags=["pnl"])


@router.get("/realized/summary", response_model=RealizedPnlSummaryResponse)
def get_realized_pnl_summary(
    db: Session = Depends(get_db),
) -> dict[str, object | None]:
    return RealizedPnlService().summary(db)


@router.get("/realized/daily", response_model=list[RealizedPnlDailyResponse])
def get_realized_pnl_daily(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    symbol: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict[str, object | None]]:
    _validate_date_range(start_date, end_date)
    normalized_symbol = symbol.upper() if symbol else None
    return RealizedPnlService().daily(
        db,
        start_date=start_date,
        end_date=end_date,
        symbol=normalized_symbol,
    )


@router.get("/realized/by-symbol", response_model=list[RealizedPnlBySymbolResponse])
def get_realized_pnl_by_symbol(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict[str, object | None]]:
    _validate_date_range(start_date, end_date)
    return RealizedPnlService().by_symbol(db, start_date=start_date, end_date=end_date)


def _validate_date_range(start_date: date | None, end_date: date | None) -> None:
    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must not be after end_date")
