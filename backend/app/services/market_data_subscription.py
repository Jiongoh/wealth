from dataclasses import asdict, dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.constants import ALPACA_FREE_MAX_SYMBOLS
from app.models import LotAnalysisDaily, WatchlistTicker


@dataclass(frozen=True)
class MarketDataSubscriptionPlan:
    symbols: list[str]
    max_symbols: int
    total_candidates: int
    subscribed_count: int
    overflow_count: int
    holdings_count: int
    watchlist_realtime_count: int
    excluded_symbols: list[str]
    warnings: list[str]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class MarketDataSubscriptionService:
    def get_subscription_symbols(
        self,
        db: Session,
        *,
        max_symbols: int = ALPACA_FREE_MAX_SYMBOLS,
    ) -> MarketDataSubscriptionPlan:
        safe_max_symbols = max(0, max_symbols)
        holding_symbols = _current_holding_symbols(db)
        watchlist_symbols = _watchlist_realtime_symbols(db)
        watchlist_only_symbols = [symbol for symbol in watchlist_symbols if symbol not in set(holding_symbols)]
        candidates = holding_symbols + watchlist_only_symbols
        subscribed_symbols = candidates[:safe_max_symbols]
        excluded_symbols = candidates[safe_max_symbols:]
        warnings: list[str] = []

        if len(holding_symbols) > safe_max_symbols:
            warnings.append(
                "Current holdings exceed ALPACA_MAX_SYMBOLS; some holding symbols were excluded."
            )
        elif excluded_symbols:
            warnings.append(
                "Subscription candidates exceed ALPACA_MAX_SYMBOLS; realtime watchlist symbols were truncated."
            )

        return MarketDataSubscriptionPlan(
            symbols=subscribed_symbols,
            max_symbols=safe_max_symbols,
            total_candidates=len(candidates),
            subscribed_count=len(subscribed_symbols),
            overflow_count=len(excluded_symbols),
            holdings_count=len(holding_symbols),
            watchlist_realtime_count=len(watchlist_symbols),
            excluded_symbols=excluded_symbols,
            warnings=warnings,
        )


def _current_holding_symbols(db: Session) -> list[str]:
    latest_date = db.scalar(select(func.max(LotAnalysisDaily.report_date)))
    if latest_date is None:
        return []
    latest_raw_flex_report_id = db.scalar(
        select(func.max(LotAnalysisDaily.raw_flex_report_id)).where(
            LotAnalysisDaily.report_date == latest_date
        )
    )
    if latest_raw_flex_report_id is None:
        return []
    rows = db.execute(
        select(LotAnalysisDaily.symbol, LotAnalysisDaily.total_quantity)
        .where(LotAnalysisDaily.report_date == latest_date)
        .where(LotAnalysisDaily.raw_flex_report_id == latest_raw_flex_report_id)
        .order_by(LotAnalysisDaily.symbol.asc())
    ).all()
    symbols = [
        _normalize_symbol(symbol)
        for symbol, total_quantity in rows
        if _is_positive_quantity(total_quantity)
    ]
    return _unique_symbols(symbols)


def _watchlist_realtime_symbols(db: Session) -> list[str]:
    rows = db.scalars(
        select(WatchlistTicker.symbol)
        .where(WatchlistTicker.realtime_enabled.is_(True))
        .order_by(WatchlistTicker.symbol.asc())
    ).all()
    return _unique_symbols(_normalize_symbol(symbol) for symbol in rows)


def _normalize_symbol(value: str | None) -> str:
    return value.strip().upper() if value else ""


def _unique_symbols(values) -> list[str]:
    symbols: list[str] = []
    seen: set[str] = set()
    for value in values:
        symbol = _normalize_symbol(value)
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    return symbols


def _is_positive_quantity(value: Decimal | None) -> bool:
    return value is not None and value > Decimal("0")
