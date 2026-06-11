from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class WatchlistTickerCreate(BaseModel):
    symbol: str
    tags: list[str] = Field(default_factory=list)
    display_name: str | None = None
    notes: str | None = None
    realtime_enabled: bool = False


class WatchlistTickerUpdate(BaseModel):
    tags: list[str] | None = None
    display_name: str | None = None
    notes: str | None = None
    realtime_enabled: bool | None = None


class WatchlistTagsCreate(BaseModel):
    names: list[str] = Field(default_factory=list)


class WatchlistTagUpdate(BaseModel):
    name: str


class WatchlistItemResponse(BaseModel):
    id: int
    symbol: str
    display_name: str | None
    notes: str | None
    realtime_enabled: bool
    tags: list[str]
    has_position: bool
    latest_report_date: date | None
    position_quantity: Decimal | None
    current_price: Decimal | None
    market_value: Decimal | None
    unrealized_pnl: Decimal | None
    updated_at: datetime


class WatchlistTagResponse(BaseModel):
    id: int
    name: str
    count: int
    color: str | None = None
