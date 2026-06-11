from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import (
    WatchlistItemResponse,
    WatchlistTagResponse,
    WatchlistTagUpdate,
    WatchlistTagsCreate,
    WatchlistTickerCreate,
    WatchlistTickerUpdate,
)
from app.services.watchlist import WatchlistService

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


@router.get("", response_model=list[WatchlistItemResponse])
def get_watchlist(
    tag: str | None = Query(default=None),
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return WatchlistService().list_items(db, tag=tag, q=q)


@router.post("", response_model=WatchlistItemResponse)
def create_watchlist_ticker(
    payload: WatchlistTickerCreate,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    symbol = payload.symbol.strip()
    if not symbol:
        raise HTTPException(status_code=422, detail="symbol is required")
    try:
        return WatchlistService().upsert_item(
            db,
            symbol=symbol,
            tags=payload.tags,
            display_name=payload.display_name,
            notes=payload.notes,
            realtime_enabled=payload.realtime_enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/tags", response_model=list[WatchlistTagResponse])
def get_watchlist_tags(db: Session = Depends(get_db)) -> list[dict[str, object]]:
    return WatchlistService().tags(db)


@router.post("/tags", response_model=list[WatchlistTagResponse])
def create_watchlist_tags(
    payload: WatchlistTagsCreate,
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    try:
        return WatchlistService().create_tags(db, payload.names)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/tags/{tag_id}", response_model=WatchlistTagResponse)
def update_watchlist_tag(
    tag_id: int,
    payload: WatchlistTagUpdate,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        result = WatchlistService().update_tag(db, tag_id, payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Watchlist tag not found")
    return result


@router.delete("/tags/{tag_id}")
def delete_watchlist_tag(tag_id: int, db: Session = Depends(get_db)) -> dict[str, bool]:
    deleted = WatchlistService().delete_tag(db, tag_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Watchlist tag not found")
    return {"success": True}


@router.patch("/{symbol}", response_model=WatchlistItemResponse)
def update_watchlist_ticker(
    symbol: str,
    payload: WatchlistTickerUpdate,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    fields = payload.model_fields_set
    try:
        result = WatchlistService().update_item(
            db,
            symbol=symbol,
            tags=payload.tags,
            display_name=payload.display_name,
            notes=payload.notes,
            realtime_enabled=payload.realtime_enabled,
            tags_provided="tags" in fields,
            display_name_provided="display_name" in fields,
            notes_provided="notes" in fields,
            realtime_enabled_provided="realtime_enabled" in fields,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Watchlist ticker not found")
    return result


@router.delete("/{symbol}", status_code=204)
def delete_watchlist_ticker(symbol: str, db: Session = Depends(get_db)) -> Response:
    WatchlistService().delete_item(db, symbol)
    return Response(status_code=204)
