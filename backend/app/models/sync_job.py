from datetime import UTC, date, datetime

from sqlalchemy import Boolean, Date, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class SyncJob(Base):
    __tablename__ = "sync_jobs"

    job_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    use_shared_schedule: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    schedule_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    daily_sync_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    weekdays_only: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    cron_expression: Mapped[str | None] = mapped_column(String(120), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_auto_sync_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
