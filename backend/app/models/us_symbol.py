from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class UsSymbol(Base):
    __tablename__ = "us_symbols"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    exchange: Mapped[str | None] = mapped_column(String(80), nullable=True)
    market_category: Mapped[str | None] = mapped_column(String(10), nullable=True)
    test_issue: Mapped[str | None] = mapped_column(String(10), nullable=True)
    financial_status: Mapped[str | None] = mapped_column(String(10), nullable=True)
    round_lot_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_etf: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_nextshares: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
