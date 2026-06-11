import logging
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.business_data import LotAnalysisDaily, PositionLot

logger = logging.getLogger(__name__)

ZERO = Decimal("0")
PROFIT_THRESHOLD = Decimal("0.20")
LONG_STOCK_ASSET_CLASSES = {"STK", "STOCK"}


class LotAnalyzer:
    def rebuild(
        self,
        db: Session,
        raw_flex_report_id: int | None = None,
        report_date: date | None = None,
    ) -> int:
        if (raw_flex_report_id is None) == (report_date is None):
            raise ValueError("Provide exactly one of raw_flex_report_id or report_date")

        if raw_flex_report_id is not None:
            analysis_filter = LotAnalysisDaily.raw_flex_report_id == raw_flex_report_id
            lot_filter = PositionLot.raw_flex_report_id == raw_flex_report_id
        else:
            analysis_filter = LotAnalysisDaily.report_date == report_date
            lot_filter = PositionLot.report_date == report_date

        db.execute(delete(LotAnalysisDaily).where(analysis_filter))
        lots = db.scalars(select(PositionLot).where(lot_filter)).all()
        grouped: dict[tuple[object, ...], list[PositionLot]] = defaultdict(list)
        for lot in lots:
            if not _is_long_stock_lot(lot):
                continue
            grouped[
                (lot.raw_flex_report_id, lot.report_date, lot.account_id, lot.symbol, lot.conid)
            ].append(lot)

        rows: list[LotAnalysisDaily] = []
        for group_lots in grouped.values():
            row = self._calculate_group(group_lots)
            if row is not None:
                rows.append(row)

        db.add_all(rows)
        db.flush()
        return len(rows)

    def _calculate_group(self, lots: list[PositionLot]) -> LotAnalysisDaily | None:
        first = lots[0]
        if any(
            lot.cost_basis_price is None
            or lot.cost_basis_price <= ZERO
            or lot.mark_price is None
            for lot in lots
        ):
            logger.warning(
                "Skipping lot analysis due to missing/invalid cost_basis_price or mark_price:"
                " raw_flex_report_id=%s report_date=%s",
                first.raw_flex_report_id,
                first.report_date,
            )
            return None
        if any(lot.cost_basis_money is None for lot in lots):
            logger.warning(
                "Skipping lot analysis due to missing cost_basis_money:"
                " raw_flex_report_id=%s report_date=%s",
                first.raw_flex_report_id,
                first.report_date,
            )
            return None

        total_quantity = sum((lot.quantity for lot in lots if lot.quantity is not None), ZERO)
        total_cost = sum(
            (lot.cost_basis_money for lot in lots if lot.cost_basis_money is not None), ZERO
        )
        unrealized_pnl = _sum_optional(lot.unrealized_pnl for lot in lots)
        highest_lot = max(lots, key=lambda lot: lot.cost_basis_price)
        current_price = highest_lot.mark_price
        highest_cost_price = highest_lot.cost_basis_price
        profit_pct = (current_price - highest_cost_price) / highest_cost_price
        remaining_quantity = total_quantity - highest_lot.quantity
        remaining_cost = total_cost - highest_lot.cost_basis_money

        return LotAnalysisDaily(
            report_date=first.report_date,
            account_id=first.account_id,
            symbol=first.symbol,
            conid=first.conid,
            total_quantity=total_quantity,
            current_price=current_price,
            total_cost_basis_money=total_cost,
            avg_cost=total_cost / total_quantity,
            unrealized_pnl=unrealized_pnl,
            highest_cost_lot_quantity=highest_lot.quantity,
            highest_cost_lot_price=highest_cost_price,
            highest_cost_lot_cost_basis_money=highest_lot.cost_basis_money,
            highest_cost_lot_open_datetime=highest_lot.open_datetime,
            highest_cost_lot_profit_pct=profit_pct,
            highest_cost_lot_profit_over_20=profit_pct >= PROFIT_THRESHOLD,
            avg_cost_without_highest_lot=(
                remaining_cost / remaining_quantity if remaining_quantity > ZERO else None
            ),
            remaining_quantity_without_highest_lot=remaining_quantity,
            remaining_cost_without_highest_lot=remaining_cost,
            raw_flex_report_id=first.raw_flex_report_id,
        )


def _is_long_stock_lot(lot: PositionLot) -> bool:
    asset_class = (lot.asset_class or "").upper()
    side = (lot.side or "").upper()
    return (
        asset_class in LONG_STOCK_ASSET_CLASSES
        and side not in {"SHORT", "S"}
        and lot.quantity is not None
        and lot.quantity > ZERO
    )


def _sum_optional(values) -> Decimal | None:
    present = [value for value in values if value is not None]
    return sum(present, ZERO) if present else None
