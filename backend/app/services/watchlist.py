from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import LotAnalysisDaily, WatchlistTag, WatchlistTicker, WatchlistTickerTag
from app.models.watchlist import utc_now

MAX_TAGS_PER_TICKER = 5
MAX_TAGS_PER_REQUEST = 5
TAG_COLOR_PALETTE = (
    "#F7DFA6",
    "#F6CFC7",
    "#CFE5D4",
    "#D8D3F0",
    "#CFE0F2",
    "#EAD7B7",
    "#F3D1E0",
    "#DDE7C7",
)


@dataclass(frozen=True)
class PositionSnapshot:
    latest_report_date: date | None
    position_quantity: Decimal | None
    current_price: Decimal | None
    market_value: Decimal | None
    unrealized_pnl: Decimal | None

    @property
    def has_position(self) -> bool:
        return self.position_quantity is not None and self.position_quantity > Decimal("0")


class WatchlistService:
    def list_items(
        self,
        db: Session,
        *,
        tag: str | None = None,
        q: str | None = None,
    ) -> list[dict[str, object]]:
        statement = (
            select(WatchlistTicker)
            .options(selectinload(WatchlistTicker.tag_links).selectinload(WatchlistTickerTag.tag))
            .order_by(WatchlistTicker.symbol.asc())
        )
        tickers = list(db.scalars(statement).all())
        if tag:
            tag_key = _normalize_tag_key(tag)
            tickers = [
                ticker
                for ticker in tickers
                if any(_normalize_tag_key(link.tag.name) == tag_key for link in ticker.tag_links)
            ]
        if q:
            query = q.strip().upper()
            tickers = [ticker for ticker in tickers if query in ticker.symbol]

        positions = _current_positions(db)
        return [_response_item(ticker, positions.get(ticker.symbol)) for ticker in tickers]

    def get_item(self, db: Session, symbol: str) -> dict[str, object] | None:
        ticker = _get_ticker(db, symbol)
        if ticker is None:
            return None
        return _response_item(ticker, _current_positions(db).get(ticker.symbol))

    def upsert_item(
        self,
        db: Session,
        *,
        symbol: str,
        tags: list[str] | None = None,
        display_name: str | None = None,
        notes: str | None = None,
        realtime_enabled: bool | None = None,
        max_symbols: int | None = None,
    ) -> dict[str, object]:
        normalized_symbol = _normalize_symbol(symbol)
        ticker = _get_ticker(db, normalized_symbol)
        if ticker is None:
            ticker = WatchlistTicker(symbol=normalized_symbol)
            db.add(ticker)
            db.flush()

        if display_name is not None:
            ticker.display_name = _blank_to_none(display_name)
        if notes is not None:
            ticker.notes = _blank_to_none(notes)
        if realtime_enabled is not None:
            if realtime_enabled and not ticker.realtime_enabled:
                self._assert_realtime_capacity(db, symbol=normalized_symbol, max_symbols=max_symbols)
            ticker.realtime_enabled = realtime_enabled
        if tags is not None:
            _replace_tags(db, ticker, tags)
        ticker.updated_at = utc_now()
        db.commit()
        db.refresh(ticker)
        return self.get_item(db, normalized_symbol) or _response_item(ticker, None)

    def update_item(
        self,
        db: Session,
        *,
        symbol: str,
        tags: list[str] | None = None,
        display_name: str | None = None,
        notes: str | None = None,
        realtime_enabled: bool | None = None,
        tags_provided: bool = False,
        display_name_provided: bool = False,
        notes_provided: bool = False,
        realtime_enabled_provided: bool = False,
        max_symbols: int | None = None,
    ) -> dict[str, object] | None:
        ticker = _get_ticker(db, symbol)
        if ticker is None:
            return None
        if display_name_provided:
            ticker.display_name = _blank_to_none(display_name)
        if notes_provided:
            ticker.notes = _blank_to_none(notes)
        if realtime_enabled_provided:
            if bool(realtime_enabled) and not ticker.realtime_enabled:
                self._assert_realtime_capacity(db, symbol=ticker.symbol, max_symbols=max_symbols)
            ticker.realtime_enabled = bool(realtime_enabled)
        if tags_provided:
            _replace_tags(db, ticker, tags or [])
        ticker.updated_at = utc_now()
        db.commit()
        db.refresh(ticker)
        return self.get_item(db, ticker.symbol)

    def _assert_realtime_capacity(self, db: Session, *, symbol: str, max_symbols: int | None) -> None:
        """Reject manual realtime subscriptions that would exceed the Alpaca cap.

        Holdings auto-subscribe and are never blocked; the cap only gates
        manually-enabled non-held symbols. Enforcement is opt-in (the API passes
        the configured limit) so internal callers/tests keep working uncapped.
        """
        if max_symbols is None:
            return
        positions = _current_positions(db)
        holdings = {sym for sym, snap in positions.items() if snap.has_position}
        normalized = _normalize_symbol(symbol)
        if normalized in holdings:
            return
        manual = {
            ticker.symbol
            for ticker in db.scalars(
                select(WatchlistTicker).where(WatchlistTicker.realtime_enabled.is_(True))
            ).all()
            if ticker.symbol not in holdings
        }
        manual.add(normalized)
        if len(holdings | manual) > max_symbols:
            raise ValueError(
                f"Realtime subscription limit reached ({max_symbols}). "
                "Unsubscribe another symbol before subscribing a new one."
            )

    def delete_item(self, db: Session, symbol: str) -> bool:
        ticker = _get_ticker(db, symbol)
        if ticker is None:
            return False
        db.delete(ticker)
        db.commit()
        return True

    def tags(self, db: Session) -> list[dict[str, object]]:
        _ensure_tag_colors(db)
        rows = db.execute(
            select(WatchlistTag.id, WatchlistTag.name, WatchlistTag.color, func.count(WatchlistTickerTag.ticker_id))
            .outerjoin(WatchlistTickerTag, WatchlistTickerTag.tag_id == WatchlistTag.id)
            .group_by(WatchlistTag.id, WatchlistTag.name, WatchlistTag.color)
            .order_by(WatchlistTag.name.asc())
        ).all()
        return [{"id": tag_id, "name": name, "color": color, "count": count} for tag_id, name, color, count in rows]

    def create_tags(self, db: Session, names: list[str]) -> list[dict[str, object]]:
        normalized_names = _unique_tag_names(names)
        if len(normalized_names) > MAX_TAGS_PER_REQUEST:
            raise ValueError(f"Cannot create more than {MAX_TAGS_PER_REQUEST} tags at once.")
        for name in normalized_names:
            _get_or_create_tag(db, name)
        db.commit()
        return self.tags(db)

    def update_tag(self, db: Session, tag_id: int, name: str) -> dict[str, object] | None:
        tag = db.get(WatchlistTag, tag_id)
        if tag is None:
            return None

        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("Tag name is required.")

        target = _get_tag_by_name(db, normalized_name)
        if target is not None and target.id != tag.id:
            self._merge_tags(db, source=tag, target=target)
            db.commit()
            return _tag_response(db, target.id)

        tag.name = normalized_name
        tag.updated_at = utc_now()
        db.commit()
        return _tag_response(db, tag.id)

    def delete_tag(self, db: Session, tag_id: int) -> bool:
        tag = db.get(WatchlistTag, tag_id)
        if tag is None:
            return False
        db.delete(tag)
        db.commit()
        return True

    def _merge_tags(self, db: Session, *, source: WatchlistTag, target: WatchlistTag) -> None:
        target_ticker_ids = set(
            db.scalars(
                select(WatchlistTickerTag.ticker_id).where(WatchlistTickerTag.tag_id == target.id)
            ).all()
        )
        source_links = list(
            db.scalars(
                select(WatchlistTickerTag).where(WatchlistTickerTag.tag_id == source.id)
            ).all()
        )

        for link in source_links:
            if link.ticker_id in target_ticker_ids:
                db.delete(link)
            else:
                link.tag_id = target.id
                target_ticker_ids.add(link.ticker_id)

        target.updated_at = utc_now()
        db.flush()
        db.delete(source)


def _current_positions(db: Session) -> dict[str, PositionSnapshot]:
    latest_date = db.scalar(select(func.max(LotAnalysisDaily.report_date)))
    if latest_date is None:
        return {}
    rows = list(
        db.scalars(
            select(LotAnalysisDaily).where(LotAnalysisDaily.report_date == latest_date)
        ).all()
    )
    snapshots: dict[str, PositionSnapshot] = {}
    for row in rows:
        if not row.symbol:
            continue
        market_value = (
            row.current_price * row.total_quantity
            if row.current_price is not None and row.total_quantity is not None
            else None
        )
        snapshots[row.symbol.upper()] = PositionSnapshot(
            latest_report_date=row.report_date,
            position_quantity=row.total_quantity,
            current_price=row.current_price,
            market_value=market_value,
            unrealized_pnl=row.unrealized_pnl,
        )
    return snapshots


def _response_item(ticker: WatchlistTicker, position: PositionSnapshot | None) -> dict[str, object]:
    tags = sorted(link.tag.name for link in ticker.tag_links)
    return {
        "id": ticker.id,
        "symbol": ticker.symbol,
        "display_name": ticker.display_name,
        "notes": ticker.notes,
        "realtime_enabled": ticker.realtime_enabled,
        "tags": tags,
        "has_position": position.has_position if position else False,
        "latest_report_date": position.latest_report_date if position else None,
        "position_quantity": position.position_quantity if position else None,
        "current_price": position.current_price if position else None,
        "market_value": position.market_value if position else None,
        "unrealized_pnl": position.unrealized_pnl if position else None,
        "updated_at": ticker.updated_at,
    }


def _replace_tags(db: Session, ticker: WatchlistTicker, tag_names: list[str]) -> None:
    normalized_names = _unique_tag_names(tag_names)
    if len(normalized_names) > MAX_TAGS_PER_TICKER:
        raise ValueError(f"Each ticker can have at most {MAX_TAGS_PER_TICKER} tags.")
    tags = [_get_or_create_tag(db, name) for name in normalized_names]
    ticker.tag_links = [WatchlistTickerTag(ticker=ticker, tag=tag) for tag in tags]


def _get_or_create_tag(db: Session, name: str) -> WatchlistTag:
    name_key = _normalize_tag_key(name)
    existing = db.scalars(select(WatchlistTag)).all()
    for tag in existing:
        if _normalize_tag_key(tag.name) == name_key:
            return tag
    tag = WatchlistTag(name=name, color=_next_tag_color(db))
    db.add(tag)
    db.flush()
    return tag


def _get_tag_by_name(db: Session, name: str) -> WatchlistTag | None:
    name_key = _normalize_tag_key(name)
    tags = db.scalars(select(WatchlistTag)).all()
    for tag in tags:
        if _normalize_tag_key(tag.name) == name_key:
            return tag
    return None


def _tag_response(db: Session, tag_id: int) -> dict[str, object] | None:
    row = db.execute(
        select(WatchlistTag.id, WatchlistTag.name, WatchlistTag.color, func.count(WatchlistTickerTag.ticker_id))
        .outerjoin(WatchlistTickerTag, WatchlistTickerTag.tag_id == WatchlistTag.id)
        .where(WatchlistTag.id == tag_id)
        .group_by(WatchlistTag.id, WatchlistTag.name, WatchlistTag.color)
    ).one_or_none()
    if row is None:
        return None
    response_id, name, color, count = row
    return {"id": response_id, "name": name, "color": color, "count": count}


def _ensure_tag_colors(db: Session) -> None:
    tags = list(db.scalars(select(WatchlistTag).order_by(WatchlistTag.id.asc())).all())
    changed = False
    for tag in tags:
        if not tag.color:
            tag.color = TAG_COLOR_PALETTE[(tag.id - 1) % len(TAG_COLOR_PALETTE)]
            changed = True
    if changed:
        db.commit()


def _next_tag_color(db: Session) -> str:
    count = db.scalar(select(func.count()).select_from(WatchlistTag)) or 0
    return TAG_COLOR_PALETTE[count % len(TAG_COLOR_PALETTE)]


def _get_ticker(db: Session, symbol: str) -> WatchlistTicker | None:
    normalized = _normalize_symbol(symbol)
    return db.scalar(
        select(WatchlistTicker)
        .options(selectinload(WatchlistTicker.tag_links).selectinload(WatchlistTickerTag.tag))
        .where(WatchlistTicker.symbol == normalized)
    )


def _normalize_symbol(value: str) -> str:
    return value.strip().upper()


def _unique_tag_names(values: list[str]) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for value in values:
        name = value.strip()
        key = _normalize_tag_key(name)
        if not name or key in seen:
            continue
        seen.add(key)
        tags.append(name)
    return tags


def _normalize_tag_key(value: str) -> str:
    return " ".join(value.strip().casefold().split())


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None
