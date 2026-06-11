from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import UsSymbol
from app.schemas.symbols import SymbolSearchResult

router = APIRouter(prefix="/symbols", tags=["symbols"])

MAX_SYMBOL_SEARCH_LIMIT = 50


@router.get("/search", response_model=list[SymbolSearchResult])
def search_symbols(
    q: str = Query(...),
    limit: int = Query(default=20),
    db: Session = Depends(get_db),
) -> list[SymbolSearchResult]:
    query = q.strip()
    if not query:
        return []

    safe_limit = max(1, min(limit, MAX_SYMBOL_SEARCH_LIMIT))
    query_upper = query.upper()
    contains_pattern = f"%{query_upper}%"
    prefix_pattern = f"{query_upper}%"

    symbol_upper = func.upper(UsSymbol.symbol)
    name_upper = func.upper(UsSymbol.name)
    rank = case(
        (symbol_upper == query_upper, 1),
        (symbol_upper.like(prefix_pattern), 2),
        (symbol_upper.like(contains_pattern), 3),
        (name_upper.like(contains_pattern), 4),
        else_=5,
    )

    statement = (
        select(UsSymbol)
        .where(
            or_(UsSymbol.test_issue.is_(None), UsSymbol.test_issue != "Y"),
            or_(
                symbol_upper.like(contains_pattern),
                name_upper.like(contains_pattern),
            ),
        )
        .order_by(rank, UsSymbol.symbol.asc())
        .limit(safe_limit)
    )
    return list(db.scalars(statement).all())
