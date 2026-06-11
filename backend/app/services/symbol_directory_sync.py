import csv
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import SyncJob, SyncRun, UsSymbol

NASDAQ_SYMBOL_SYNC_JOB_KEY = "nasdaq_symbol_sync"
DEFAULT_SYMBOL_CSV_PATH = "/root/wealth/storage/symbols/us_symbols.csv"
CONTAINER_SYMBOL_CSV_PATH = "/app/storage/symbols/us_symbols.csv"

CSV_COLUMNS = {
    "symbol",
    "name",
    "exchange",
    "market_category",
    "test_issue",
    "financial_status",
    "round_lot_size",
    "is_etf",
    "is_nextshares",
    "source_file",
}
UPSERT_BATCH_SIZE = 1000


@dataclass(frozen=True)
class SymbolDirectorySyncResult:
    sync_run_id: int
    status: str
    rows_total: int
    rows_inserted: int
    rows_updated: int
    artifact_path: str
    error_message: str | None


class SymbolDirectorySyncService:
    def import_from_csv(
        self,
        db: Session,
        file_path: str = DEFAULT_SYMBOL_CSV_PATH,
    ) -> SymbolDirectorySyncResult:
        started_at = datetime.now(UTC)
        sync_run = SyncRun(
            job_key=NASDAQ_SYMBOL_SYNC_JOB_KEY,
            started_at=started_at,
            status="running",
            artifact_path=file_path,
            metadata_json={"source": "local_csv", "requested_path": file_path},
        )
        db.add(sync_run)
        db.commit()
        db.refresh(sync_run)
        sync_run_id = sync_run.id

        try:
            resolved_path = self._resolve_file_path(file_path)
            records = self._read_csv(resolved_path)
            existing_symbols = set(
                db.scalars(select(UsSymbol.symbol).where(UsSymbol.symbol.in_([row["symbol"] for row in records]))).all()
            )
            self._upsert_symbols(db, records)
            finished_at = datetime.now(UTC)
            rows_total = len(records)
            rows_updated = len(existing_symbols)
            rows_inserted = rows_total - rows_updated

            sync_run.status = "success"
            sync_run.finished_at = finished_at
            sync_run.duration_ms = _duration_ms(started_at, finished_at)
            sync_run.rows_total = rows_total
            sync_run.rows_inserted = rows_inserted
            sync_run.rows_updated = rows_updated
            sync_run.rows_deleted = 0
            sync_run.metadata_json = {
                "source": "local_csv",
                "requested_path": file_path,
                "resolved_path": str(resolved_path),
                "unique_symbols": rows_total,
            }
            sync_run.message = (
                "Imported Nasdaq Symbol Directory CSV. "
                f"rows_total={rows_total}, rows_inserted={rows_inserted}, rows_updated={rows_updated}."
            )
            self._update_job(db, status="success", last_run_at=finished_at)
            db.commit()
            return SymbolDirectorySyncResult(
                sync_run_id=sync_run.id,
                status=sync_run.status,
                rows_total=rows_total,
                rows_inserted=rows_inserted,
                rows_updated=rows_updated,
                artifact_path=file_path,
                error_message=None,
            )
        except Exception as exc:
            db.rollback()
            finished_at = datetime.now(UTC)
            sync_run = db.get(SyncRun, sync_run_id)
            if sync_run is None:
                sync_run = SyncRun(
                    job_key=NASDAQ_SYMBOL_SYNC_JOB_KEY,
                    started_at=started_at,
                    status="failed",
                    artifact_path=file_path,
                )
                db.add(sync_run)
            error_message = _summarize_error(exc)
            sync_run.status = "failed"
            sync_run.finished_at = finished_at
            sync_run.duration_ms = _duration_ms(started_at, finished_at)
            sync_run.error_message = error_message
            sync_run.message = error_message
            self._update_job(db, status="failed", last_run_at=finished_at)
            db.commit()
            return SymbolDirectorySyncResult(
                sync_run_id=sync_run.id,
                status=sync_run.status,
                rows_total=sync_run.rows_total or 0,
                rows_inserted=sync_run.rows_inserted or 0,
                rows_updated=sync_run.rows_updated or 0,
                artifact_path=file_path,
                error_message=sync_run.error_message,
            )

    def download_from_nasdaq(self) -> None:
        raise NotImplementedError("Remote Nasdaq Symbol Directory download is not implemented")

    def _resolve_file_path(self, file_path: str) -> Path:
        path = Path(file_path)
        if path.exists():
            return path
        if file_path == DEFAULT_SYMBOL_CSV_PATH:
            container_path = Path(CONTAINER_SYMBOL_CSV_PATH)
            if container_path.exists():
                return container_path
        raise FileNotFoundError(f"Symbol CSV file not found: {file_path}")

    def _read_csv(self, file_path: Path) -> list[dict[str, Any]]:
        with file_path.open(newline="", encoding="utf-8") as csv_file:
            reader = csv.DictReader(csv_file)
            fieldnames = set(reader.fieldnames or [])
            missing_columns = sorted(CSV_COLUMNS - fieldnames)
            if missing_columns:
                raise ValueError(f"Symbol CSV missing required columns: {', '.join(missing_columns)}")

            records: dict[str, dict[str, Any]] = {}
            for line_number, row in enumerate(reader, start=2):
                record = self._normalize_row(row, line_number)
                records[record["symbol"]] = record
        return list(records.values())

    def _normalize_row(self, row: dict[str, str | None], line_number: int) -> dict[str, Any]:
        symbol = _clean_text(row.get("symbol"))
        if symbol is None:
            raise ValueError(f"Symbol CSV row {line_number} has an empty symbol")
        return {
            "symbol": symbol.upper(),
            "name": _clean_text(row.get("name")),
            "exchange": _clean_text(row.get("exchange")),
            "market_category": _clean_text(row.get("market_category")),
            "test_issue": _clean_text(row.get("test_issue")),
            "financial_status": _clean_text(row.get("financial_status")),
            "round_lot_size": _parse_int(row.get("round_lot_size"), line_number, "round_lot_size"),
            "is_etf": _parse_bool(row.get("is_etf"), line_number, "is_etf"),
            "is_nextshares": _parse_bool(row.get("is_nextshares"), line_number, "is_nextshares"),
            "source_file": _clean_text(row.get("source_file")),
        }

    def _upsert_symbols(self, db: Session, records: list[dict[str, Any]]) -> None:
        if not records:
            return
        for start in range(0, len(records), UPSERT_BATCH_SIZE):
            batch = records[start : start + UPSERT_BATCH_SIZE]
            now = datetime.now(UTC)
            values = [{**record, "created_at": now, "updated_at": now} for record in batch]
            statement = insert(UsSymbol).values(values)
            update_columns = {
                "name": statement.excluded.name,
                "exchange": statement.excluded.exchange,
                "market_category": statement.excluded.market_category,
                "test_issue": statement.excluded.test_issue,
                "financial_status": statement.excluded.financial_status,
                "round_lot_size": statement.excluded.round_lot_size,
                "is_etf": statement.excluded.is_etf,
                "is_nextshares": statement.excluded.is_nextshares,
                "source_file": statement.excluded.source_file,
                "updated_at": now,
            }
            db.execute(statement.on_conflict_do_update(index_elements=[UsSymbol.symbol], set_=update_columns))

    def _update_job(self, db: Session, *, status: str, last_run_at: datetime) -> None:
        job = db.get(SyncJob, NASDAQ_SYMBOL_SYNC_JOB_KEY)
        if job is None:
            job = SyncJob(
                job_key=NASDAQ_SYMBOL_SYNC_JOB_KEY,
                display_name="Nasdaq Symbol Directory Sync",
                enabled=True,
            )
            db.add(job)
        job.status = status
        job.last_run_at = last_run_at
        job.updated_at = datetime.now(UTC)


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _parse_int(value: str | None, line_number: int, column: str) -> int | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None
    try:
        return int(cleaned)
    except ValueError as exc:
        raise ValueError(f"Symbol CSV row {line_number} has invalid {column}: {cleaned}") from exc


def _parse_bool(value: str | None, line_number: int, column: str) -> bool | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None
    normalized = cleaned.upper()
    if normalized == "Y":
        return True
    if normalized == "N":
        return False
    raise ValueError(f"Symbol CSV row {line_number} has invalid {column}: {cleaned}")


def _duration_ms(started_at: datetime, finished_at: datetime) -> int:
    return int((finished_at - started_at).total_seconds() * 1000)


def _summarize_error(exc: Exception) -> str:
    message = str(exc).splitlines()[0]
    if len(message) > 1000:
        message = f"{message[:997]}..."
    return f"{type(exc).__name__}: {message}"
