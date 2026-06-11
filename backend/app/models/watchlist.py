from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class WatchlistTicker(Base):
    __tablename__ = "watchlist_tickers"
    __table_args__ = (UniqueConstraint("symbol", name="uq_watchlist_tickers_symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    realtime_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    tag_links: Mapped[list["WatchlistTickerTag"]] = relationship(
        back_populates="ticker",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class WatchlistTag(Base):
    __tablename__ = "watchlist_tags"
    __table_args__ = (UniqueConstraint("name", name="uq_watchlist_tags_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    ticker_links: Mapped[list["WatchlistTickerTag"]] = relationship(
        back_populates="tag",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class WatchlistTickerTag(Base):
    __tablename__ = "watchlist_ticker_tags"
    __table_args__ = (
        UniqueConstraint("ticker_id", "tag_id", name="uq_watchlist_ticker_tags_pair"),
    )

    ticker_id: Mapped[int] = mapped_column(
        ForeignKey("watchlist_tickers.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        ForeignKey("watchlist_tags.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    ticker: Mapped[WatchlistTicker] = relationship(back_populates="tag_links")
    tag: Mapped[WatchlistTag] = relationship(back_populates="ticker_links")
