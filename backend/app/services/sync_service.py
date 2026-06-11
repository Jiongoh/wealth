from datetime import UTC, datetime
import logging
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import Settings
from app.models.raw_flex_report import RawFlexReport
from app.models.sync_run import SyncRun
from app.services.ibkr_client import IBKRFlexClient
from app.services.ingestion_service import IngestionService
from app.services.raw_xml_archive import RawXmlArchive

logger = logging.getLogger(__name__)


class XmlDownloader(Protocol):
    def download_xml(self) -> bytes: ...


class SyncService:
    def __init__(
        self,
        settings: Settings,
        downloader: XmlDownloader | None = None,
        ingestion_service: IngestionService | None = None,
    ) -> None:
        self.settings = settings
        self.downloader = downloader
        self.ingestion_service = ingestion_service or IngestionService()

    def run(self, db: Session) -> SyncRun:
        raw_flex_report_id: int | None = None
        sync_run = SyncRun(started_at=datetime.now(UTC), status="running")
        db.add(sync_run)
        db.commit()
        db.refresh(sync_run)

        try:
            # Tests may explicitly inject a downloader; API calls use the real IBKR client.
            downloader = self.downloader or IBKRFlexClient(self.settings)
            xml_content = downloader.download_xml()
            archive_result = RawXmlArchive(self.settings.raw_xml_dir).archive(
                db, self.settings.ibkr_query_id, xml_content
            )
            raw_flex_report_id = archive_result.report.id
            sync_run.raw_flex_report_id = raw_flex_report_id
            # Keep the raw archive available even when parsing or ingestion fails.
            db.commit()
            ingestion = self.ingestion_service.ingest_report(db, raw_flex_report_id)
            sync_run = db.get(SyncRun, sync_run.id)
            if sync_run is None:
                raise RuntimeError("Sync run disappeared while ingesting Flex XML")
            report = db.get(RawFlexReport, raw_flex_report_id)
            sync_run.report_date = report.report_date if report is not None else None
            sync_run.status = "duplicate" if archive_result.duplicate else "success"
            sync_run.message = (
                "Raw XML already archived; existing report reprocessed."
                if archive_result.duplicate
                else "Raw XML downloaded, archived and parsed."
            )
            sync_run.message += (
                f" Ingested positions_lot={ingestion.positions_lot}, trades={ingestion.trades},"
                f" cash_report={ingestion.cash_report}, nav_daily={ingestion.nav_daily},"
                f" lot_analysis_daily={ingestion.lot_analysis_daily}."
            )
        except Exception as exc:
            db.rollback()
            sync_run = db.get(SyncRun, sync_run.id)
            if sync_run is None:
                raise
            sync_run.status = "failed"
            sync_run.message = _redact_token(str(exc), self.settings.ibkr_token)
            if raw_flex_report_id is not None:
                sync_run.raw_flex_report_id = raw_flex_report_id
            logger.error(
                "IBKR Flex synchronization failed: sync_run_id=%s error=%s",
                sync_run.id,
                sync_run.message,
            )

        sync_run.finished_at = datetime.now(UTC)
        db.commit()
        db.refresh(sync_run)
        return sync_run

    def get_latest_status(self, db: Session) -> tuple[SyncRun | None, RawFlexReport | None]:
        latest_run = db.scalar(
            select(SyncRun)
            .options(joinedload(SyncRun.raw_flex_report))
            .order_by(SyncRun.started_at.desc(), SyncRun.id.desc())
            .limit(1)
        )
        latest_report = db.scalar(
            select(RawFlexReport)
            .order_by(RawFlexReport.downloaded_at.desc(), RawFlexReport.id.desc())
            .limit(1)
        )
        return latest_run, latest_report


def _redact_token(message: str, token: str) -> str:
    if token:
        return message.replace(token, "[REDACTED]")
    return message
