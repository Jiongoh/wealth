from datetime import UTC, date, datetime

from sqlalchemy import Boolean, Date, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class SyncSchedule(Base):
    __tablename__ = "sync_schedule"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    daily_sync_time: Mapped[str] = mapped_column(String(5), nullable=False)
    timezone_name: Mapped[str] = mapped_column(String(128), nullable=False)
    weekdays_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_auto_sync_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
