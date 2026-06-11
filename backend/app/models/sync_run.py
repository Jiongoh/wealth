from datetime import UTC, date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.raw_flex_report import RawFlexReport


def utc_now() -> datetime:
    return datetime.now(UTC)


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_key: Mapped[str] = mapped_column(
        String(80), ForeignKey("sync_jobs.job_key"), nullable=False, default="ibkr_flex_sync"
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rows_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rows_inserted: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rows_updated: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rows_deleted: Mapped[int | None] = mapped_column(Integer, nullable=True)
    artifact_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    raw_flex_report_id: Mapped[int | None] = mapped_column(
        ForeignKey("raw_flex_reports.id"), nullable=True
    )

    raw_flex_report: Mapped["RawFlexReport | None"] = relationship(back_populates="sync_runs")
