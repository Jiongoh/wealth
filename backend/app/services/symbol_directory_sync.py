import csv
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import SyncJob, SyncRun, UsSymbol

NASDAQ_SYMBOL_SYNC_JOB_KEY = "nasdaq_symbol_sync"
DEFAULT_SYMBOL_CSV_PATH = "/root/wealth/storage/symbols/us_symbols.csv"
CONTAINER_SYMBOL_CSV_PATH = "/app/storage/symbols/us_symbols.csv"

# The official Nasdaq Symbol Directory is published as two pipe-delimited files.
# The HTTPS mirror below is the same content served over FTP at
# ftp.nasdaqtrader.com/SymbolDirectory/.
NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
NASDAQ_DOWNLOAD_TIMEOUT_SECONDS = 30.0
NASDAQ_EXCHANGE_NAME = "NASDAQ"

# otherlisted.txt encodes the listing venue as a single-letter code; map it to
# the display names already stored from the previous CSV import so the data
# stays consistent across the cut-over.
OTHER_EXCHANGE_NAMES = {
    "A": "NYSE American",
    "N": "NYSE",
    "P": "NYSE Arca",
    "Z": "Cboe BZX",
    "V": "IEX",
}

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

# Callable that fetches a URL and returns its raw bytes; injectable for tests.
Fetcher = Callable[[str], bytes]


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
    def sync_from_nasdaq(self, db: Session, *, fetch: Fetcher | None = None) -> SymbolDirectorySyncResult:
        """Download the live Nasdaq Symbol Directory (nasdaqlisted.txt +
        otherlisted.txt) and import it. This is the real sync path: unlike the
        previous flow it does not depend on a manually refreshed local CSV."""
        fetcher = fetch or self._download
        artifact_path = f"{NASDAQ_LISTED_URL},{OTHER_LISTED_URL}"

        def load_records() -> tuple[list[dict[str, Any]], dict[str, Any]]:
            nasdaq_rows = self._parse_nasdaq_listed(fetcher(NASDAQ_LISTED_URL))
            other_rows = self._parse_other_listed(fetcher(OTHER_LISTED_URL))
            # other-listed first so a (rare) duplicate symbol resolves to the
            # Nasdaq-listed record.
            records: dict[str, dict[str, Any]] = {}
            for record in (*other_rows, *nasdaq_rows):
                records[record["symbol"]] = record
            metadata = {
                "nasdaqlisted_rows": len(nasdaq_rows),
                "otherlisted_rows": len(other_rows),
            }
            return list(records.values()), metadata

        return self._run_sync(db, source="nasdaq_trader", artifact_path=artifact_path, load_records=load_records)

    def import_from_csv(
        self,
        db: Session,
        file_path: str = DEFAULT_SYMBOL_CSV_PATH,
    ) -> SymbolDirectorySyncResult:
        """Import from a local CSV file (used by the offline sync_symbols
        script and as a manual fallback)."""

        def load_records() -> tuple[list[dict[str, Any]], dict[str, Any]]:
            resolved_path = self._resolve_file_path(file_path)
            records = self._read_csv(resolved_path)
            return records, {"requested_path": file_path, "resolved_path": str(resolved_path)}

        return self._run_sync(db, source="local_csv", artifact_path=file_path, load_records=load_records)

    def _run_sync(
        self,
        db: Session,
        *,
        source: str,
        artifact_path: str,
        load_records: Callable[[], tuple[list[dict[str, Any]], dict[str, Any]]],
    ) -> SymbolDirectorySyncResult:
        started_at = datetime.now(UTC)
        sync_run = SyncRun(
            job_key=NASDAQ_SYMBOL_SYNC_JOB_KEY,
            started_at=started_at,
            status="running",
            artifact_path=artifact_path,
            metadata_json={"source": source},
        )
        db.add(sync_run)
        db.commit()
        db.refresh(sync_run)
        sync_run_id = sync_run.id

        try:
            records, extra_metadata = load_records()
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
                "source": source,
                **extra_metadata,
                "unique_symbols": rows_total,
            }
            sync_run.message = (
                f"Imported Nasdaq Symbol Directory ({source}). "
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
                artifact_path=artifact_path,
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
                    artifact_path=artifact_path,
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
                artifact_path=artifact_path,
                error_message=sync_run.error_message,
            )

    def _download(self, url: str) -> bytes:
        response = httpx.get(
            url,
            headers={"User-Agent": "wealth-symbol-sync/1.0"},
            timeout=NASDAQ_DOWNLOAD_TIMEOUT_SECONDS,
            follow_redirects=True,
        )
        response.raise_for_status()
        return response.content

    def _parse_nasdaq_listed(self, content: bytes) -> list[dict[str, Any]]:
        # Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
        records: list[dict[str, Any]] = []
        for fields in self._iter_pipe_rows(content, expected_header="Symbol"):
            symbol = _clean_text(fields[0])
            if symbol is None:
                continue
            records.append(
                {
                    "symbol": symbol.upper(),
                    "name": _clean_text(fields[1]),
                    "exchange": NASDAQ_EXCHANGE_NAME,
                    "market_category": _clean_text(fields[2]),
                    "test_issue": _clean_text(fields[3]),
                    "financial_status": _clean_text(fields[4]),
                    "round_lot_size": _parse_int_lenient(fields[5]),
                    "is_etf": _parse_bool_lenient(fields[6]),
                    "is_nextshares": _parse_bool_lenient(fields[7]),
                    "source_file": "nasdaqlisted.txt",
                }
            )
        return records

    def _parse_other_listed(self, content: bytes) -> list[dict[str, Any]]:
        # ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
        records: list[dict[str, Any]] = []
        for fields in self._iter_pipe_rows(content, expected_header="ACT Symbol"):
            symbol = _clean_text(fields[0])
            if symbol is None:
                continue
            exchange_code = _clean_text(fields[2])
            records.append(
                {
                    "symbol": symbol.upper(),
                    "name": _clean_text(fields[1]),
                    "exchange": OTHER_EXCHANGE_NAMES.get(exchange_code, exchange_code) if exchange_code else None,
                    "market_category": None,
                    "test_issue": _clean_text(fields[6]),
                    "financial_status": None,
                    "round_lot_size": _parse_int_lenient(fields[5]),
                    "is_etf": _parse_bool_lenient(fields[4]),
                    "is_nextshares": None,
                    "source_file": "otherlisted.txt",
                }
            )
        return records

    def _iter_pipe_rows(self, content: bytes, *, expected_header: str) -> Iterator[list[str]]:
        text = content.decode("utf-8", errors="replace")
        lines = text.splitlines()
        if not lines:
            raise ValueError("Nasdaq directory file was empty")
        header = lines[0].split("|")
        if not header or header[0].strip() != expected_header:
            raise ValueError(f"Unexpected Nasdaq directory header: {lines[0][:80]!r}")
        for line in lines[1:]:
            if not line.strip():
                continue
            # The files end with a "File Creation Time: ..." trailer row.
            if line.startswith("File Creation Time"):
                continue
            fields = line.split("|")
            if len(fields) < 8:
                continue
            yield fields

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


def _parse_int_lenient(value: str | None) -> int | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None
    try:
        return int(cleaned)
    except ValueError:
        return None


def _parse_bool_lenient(value: str | None) -> bool | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None
    normalized = cleaned.upper()
    if normalized == "Y":
        return True
    if normalized == "N":
        return False
    return None


def _duration_ms(started_at: datetime, finished_at: datetime) -> int:
    return int((finished_at - started_at).total_seconds() * 1000)


def _summarize_error(exc: Exception) -> str:
    message = str(exc).splitlines()[0] if str(exc) else exc.__class__.__name__
    if len(message) > 1000:
        message = f"{message[:997]}..."
    return f"{type(exc).__name__}: {message}"
