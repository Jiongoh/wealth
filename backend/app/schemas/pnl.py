from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class RealizedPnlSummaryResponse(BaseModel):
    total_realized_pnl: Decimal
    currency: str | None
    start_date: date | None
    end_date: date | None


class RealizedPnlDailyResponse(BaseModel):
    date: date
    currency: str | None
    realized_pnl: Decimal
    trade_count: int


class RealizedPnlBySymbolResponse(BaseModel):
    symbol: str | None
    conid: str | None
    currency: str | None
    realized_pnl: Decimal
    trade_count: int
