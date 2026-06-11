from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.raw_flex_report import RawFlexReport


@dataclass(frozen=True)
class ArchiveResult:
    report: RawFlexReport
    duplicate: bool


class RawXmlArchive:
    def __init__(self, raw_xml_dir: str) -> None:
        self.raw_xml_dir = Path(raw_xml_dir)

    def archive(self, db: Session, query_id: str, xml_content: bytes) -> ArchiveResult:
        xml_sha256 = sha256(xml_content).hexdigest()
        existing = db.scalar(
            select(RawFlexReport).where(RawFlexReport.xml_sha256 == xml_sha256)
        )
        if existing is not None:
            return ArchiveResult(report=existing, duplicate=True)

        downloaded_at = datetime.now(UTC)
        self.raw_xml_dir.mkdir(parents=True, exist_ok=True)
        filename = (
            f"flex_{query_id}_{downloaded_at.strftime('%Y%m%dT%H%M%SZ')}_"
            f"{xml_sha256[:12]}.xml"
        )
        xml_path = self.raw_xml_dir / filename
        xml_path.write_bytes(xml_content)

        report = RawFlexReport(
            report_date=None,
            query_id=query_id,
            xml_path=str(xml_path),
            xml_sha256=xml_sha256,
            downloaded_at=downloaded_at,
            status="archived",
        )
        db.add(report)
        db.flush()
        return ArchiveResult(report=report, duplicate=False)
