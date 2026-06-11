from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models import MarketCandle
from app.models.market_data import utc_now


@dataclass(frozen=True)
class MarketDataCleanupResult:
    candle_cutoff: str
    retention_minutes: int
    status_retention_days: int
    deleted_candles: int
    deleted_quotes: int = 0
    deleted_provider_status: int = 0
    quotes_cleanup_mode: str = "snapshot_upsert_no_delete"
    provider_status_cleanup_mode: str = "snapshot_upsert_no_delete"

    def to_dict(self) -> dict[str, object]:
        return {
            "candle_cutoff": self.candle_cutoff,
            "retention_minutes": self.retention_minutes,
            "status_retention_days": self.status_retention_days,
            "deleted_candles": self.deleted_candles,
            "deleted_quotes": self.deleted_quotes,
            "deleted_provider_status": self.deleted_provider_status,
            "quotes_cleanup_mode": self.quotes_cleanup_mode,
            "provider_status_cleanup_mode": self.provider_status_cleanup_mode,
        }


def cleanup_market_data(
    db: Session,
    *,
    retention_minutes: int,
    status_retention_days: int,
) -> MarketDataCleanupResult:
    normalized_retention_minutes = max(1, retention_minutes)
    normalized_status_retention_days = max(1, status_retention_days)
    cutoff = utc_now() - timedelta(minutes=normalized_retention_minutes)
    result = db.execute(delete(MarketCandle).where(MarketCandle.timestamp < cutoff))
    db.commit()
    deleted_candles = result.rowcount if result.rowcount is not None else 0
    return MarketDataCleanupResult(
        candle_cutoff=cutoff.isoformat(),
        retention_minutes=normalized_retention_minutes,
        status_retention_days=normalized_status_retention_days,
        deleted_candles=deleted_candles,
    )
