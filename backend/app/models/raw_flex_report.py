from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.sync_run import SyncRun


class RawFlexReport(Base):
    __tablename__ = "raw_flex_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    query_id: Mapped[str] = mapped_column(String(255), nullable=False)
    xml_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    xml_sha256: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    downloaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    sync_runs: Mapped[list["SyncRun"]] = relationship(back_populates="raw_flex_report")
