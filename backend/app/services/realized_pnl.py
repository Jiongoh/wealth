from collections import Counter
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Trade

SETTLEMENT_CURRENCY = "USD"


@dataclass(frozen=True)
class RealizedTrade:
    trade_date: date
    symbol: str | None
    conid: str | None
    currency: str | None
    realized_pnl: Decimal


class RealizedPnlService:
    def realized_trades(
        self,
        db: Session,
        *,
        start_date: date | None = None,
        end_date: date | None = None,
        symbol: str | None = None,
    ) -> list[RealizedTrade]:
        statement = select(Trade).where(
            Trade.realized_pnl.is_not(None),
            or_(Trade.currency == SETTLEMENT_CURRENCY, Trade.currency.is_(None)),
        )
        if symbol is not None:
            statement = statement.where(Trade.symbol == symbol)

        rows = list(
            db.scalars(
                statement.order_by(
                    Trade.raw_flex_report_id.desc(),
                    Trade.report_date.desc().nullslast(),
                    Trade.id.asc(),
                )
            ).all()
        )
        rows = _prefer_closed_lot_rows(rows)

        realized_rows: list[RealizedTrade] = []
        seen: set[tuple[object, ...]] = set()
        occurrence_by_report: Counter[tuple[int, tuple[object, ...]]] = Counter()

        for row in rows:
            effective_date = _effective_date(row)
            if effective_date is None:
                continue
            if start_date is not None and effective_date < start_date:
                continue
            if end_date is not None and effective_date > end_date:
                continue
            if row.realized_pnl is None or row.realized_pnl == Decimal("0"):
                continue

            logical_key = _logical_trade_key(row, effective_date)
            report_key = (row.raw_flex_report_id, logical_key)
            occurrence_by_report[report_key] += 1
            dedupe_key = (*logical_key, occurrence_by_report[report_key])
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)

            realized_rows.append(
                RealizedTrade(
                    trade_date=effective_date,
                    symbol=row.symbol,
                    conid=row.conid,
                    currency=row.currency,
                    realized_pnl=row.realized_pnl,
                )
            )

        return realized_rows

    def summary(self, db: Session) -> dict[str, object | None]:
        rows = self.realized_trades(db)
        if not rows:
            return {
                "total_realized_pnl": Decimal("0"),
                "currency": None,
                "start_date": None,
                "end_date": None,
            }

        dates = [row.trade_date for row in rows]
        currencies = sorted({row.currency for row in rows if row.currency})
        return {
            "total_realized_pnl": sum((row.realized_pnl for row in rows), Decimal("0")),
            "currency": currencies[0] if len(currencies) == 1 else "MULTI" if currencies else None,
            "start_date": min(dates),
            "end_date": max(dates),
        }

    def daily(
        self,
        db: Session,
        *,
        start_date: date | None = None,
        end_date: date | None = None,
        symbol: str | None = None,
    ) -> list[dict[str, object | None]]:
        grouped: dict[tuple[date, str | None], dict[str, object | None]] = {}
        for row in self.realized_trades(
            db, start_date=start_date, end_date=end_date, symbol=symbol
        ):
            key = (row.trade_date, row.currency)
            current = grouped.setdefault(
                key,
                {
                    "date": row.trade_date,
                    "currency": row.currency,
                    "realized_pnl": Decimal("0"),
                    "trade_count": 0,
                },
            )
            current["realized_pnl"] = current["realized_pnl"] + row.realized_pnl
            current["trade_count"] = current["trade_count"] + 1

        return [
            grouped[key]
            for key in sorted(grouped, key=lambda item: (item[0], item[1] or ""))
        ]

    def by_symbol(
        self,
        db: Session,
        *,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[dict[str, object | None]]:
        grouped: dict[tuple[str | None, str | None, str | None], dict[str, object | None]] = {}
        for row in self.realized_trades(db, start_date=start_date, end_date=end_date):
            key = (row.symbol, row.conid, row.currency)
            current = grouped.setdefault(
                key,
                {
                    "symbol": row.symbol,
                    "conid": row.conid,
                    "currency": row.currency,
                    "realized_pnl": Decimal("0"),
                    "trade_count": 0,
                },
            )
            current["realized_pnl"] = current["realized_pnl"] + row.realized_pnl
            current["trade_count"] = current["trade_count"] + 1

        return [
            grouped[key]
            for key in sorted(
                grouped,
                key=lambda item: (
                    item[0] or "",
                    item[1] or "",
                    item[2] or "",
                ),
            )
        ]


def _prefer_closed_lot_rows(rows: list[Trade]) -> list[Trade]:
    closed_rows = [row for row in rows if _is_closed_lot_row(row)]
    return closed_rows if closed_rows else rows


def _is_closed_lot_row(row: Trade) -> bool:
    return "closed" in (row.level_of_detail or "").lower()


def _effective_date(row: Trade) -> date | None:
    if row.trade_date is not None:
        return row.trade_date
    if row.datetime is not None:
        return row.datetime.date()
    return row.report_date


def _logical_trade_key(row: Trade, effective_date: date) -> tuple[object, ...]:
    return (
        row.account_id,
        row.transaction_id,
        row.ib_execution_id,
        row.order_id,
        row.orig_trade_id,
        row.orig_order_id,
        effective_date,
        row.datetime,
        row.symbol,
        row.conid,
        row.asset_class,
        row.currency,
        row.quantity,
        row.trade_price,
        row.cost_basis,
        row.realized_pnl,
        row.level_of_detail,
    )
