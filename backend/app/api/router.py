from fastapi import APIRouter

from app.api.activity import router as activity_router
from app.api.market import router as market_router
from app.api.pnl import router as pnl_router
from app.api.portfolio import router as portfolio_router
from app.api.positions import router as positions_router
from app.api.symbols import router as symbols_router
from app.api.sync import router as sync_router
from app.api.watchlist import router as watchlist_router
from app.core.config import get_settings

router = APIRouter(prefix="/api")
router.include_router(portfolio_router)
router.include_router(positions_router)
router.include_router(activity_router)
router.include_router(market_router)
router.include_router(pnl_router)
router.include_router(symbols_router)
router.include_router(sync_router)
router.include_router(watchlist_router)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/version")
def version() -> dict[str, str]:
    settings = get_settings()
    return {"app": settings.app_name, "version": settings.app_version}
