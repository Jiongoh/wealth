import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router as api_router
from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.services.sync_scheduler import create_sync_scheduler

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)


def build_lifespan(app_settings: Settings, scheduler_factory=create_sync_scheduler):
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        logger.info("Starting %s version=%s", app_settings.app_name, app_settings.app_version)
        scheduler = None
        if app_settings.enable_sync_scheduler:
            scheduler = scheduler_factory(app_settings)
            scheduler.start()
            application.state.scheduler = scheduler
            logger.info(
                "Sync job schedule checker started: timezone=%s default_time=%02d:%02d",
                app_settings.app_timezone,
                app_settings.sync_cron_hour,
                app_settings.sync_cron_minute,
            )
        else:
            application.state.scheduler = None
            logger.info("Sync job schedule checker disabled by ENABLE_SYNC_SCHEDULER=false")
        try:
            yield
        finally:
            if scheduler is not None:
                scheduler.shutdown(wait=False)
            logger.info("Stopping %s", app_settings.app_name)

    return lifespan


def create_app(app_settings: Settings = settings, scheduler_factory=create_sync_scheduler) -> FastAPI:
    application = FastAPI(
        title=app_settings.app_name,
        version=app_settings.app_version,
        lifespan=build_lifespan(app_settings, scheduler_factory),
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(application)
    application.include_router(api_router)
    return application


app = create_app()
