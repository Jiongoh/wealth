import logging
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from app.core.config import Settings
from app.db.session import get_session_factory
from app.models import SyncJob
from app.services.sync_runner import SyncRunner
from app.services.sync_schedule import (
    configured_timezone,
    get_or_create_schedule,
    mark_auto_sync_attempted,
    mark_job_auto_sync_attempted,
    should_run_now,
    should_run_now_values,
    timezone_from_name,
)
from app.services.sync_service import SyncService
from app.services.symbol_directory_sync import NASDAQ_SYMBOL_SYNC_JOB_KEY, SymbolDirectorySyncService

logger = logging.getLogger(__name__)

IBKR_FLEX_JOB_KEY = "ibkr_flex_sync"


def create_sync_scheduler(settings: Settings) -> BackgroundScheduler:
    timezone = configured_timezone(settings)

    scheduler = BackgroundScheduler(timezone=timezone)
    trigger = CronTrigger(minute="*", timezone=timezone)
    scheduler.add_job(
        run_scheduled_sync,
        trigger=trigger,
        args=[settings],
        id="daily_ibkr_sync",
        name="Sync job schedule checker",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    return scheduler


def run_scheduled_sync(settings: Settings) -> None:
    with get_session_factory()() as db:
        shared_schedule = get_or_create_schedule(db, settings)
        jobs = db.scalars(select(SyncJob).where(SyncJob.enabled.is_(True)).order_by(SyncJob.job_key.asc())).all()
        legacy_ibkr_job_exists = any(job.job_key == IBKR_FLEX_JOB_KEY for job in jobs)

        if not legacy_ibkr_job_exists:
            timezone = configured_timezone(settings)
            now = datetime.now(timezone)
            decision = should_run_now(shared_schedule, now)
            if not decision.should_run:
                logger.debug(
                    "Scheduled IBKR synchronization skipped: reason=%s time=%s weekdays_only=%s",
                    decision.reason,
                    shared_schedule.daily_sync_time,
                    shared_schedule.weekdays_only,
                )
                return

            mark_auto_sync_attempted(db, shared_schedule, now.date())
            SyncRunner(SyncService(settings)).run(db, trigger="scheduled", skip_if_busy=True)
            return

        for job in jobs:
            daily_sync_time = shared_schedule.daily_sync_time if job.use_shared_schedule else job.daily_sync_time
            timezone_name = shared_schedule.timezone_name if job.use_shared_schedule else job.timezone
            weekdays_only = shared_schedule.weekdays_only if job.use_shared_schedule else bool(job.weekdays_only)
            if not daily_sync_time or not timezone_name:
                logger.debug("Scheduled sync skipped: job_key=%s reason=incomplete-schedule", job.job_key)
                continue

            timezone = timezone_from_name(timezone_name)
            now = datetime.now(timezone)
            decision = should_run_now_values(
                daily_sync_time=daily_sync_time,
                weekdays_only=weekdays_only,
                last_auto_sync_date=job.last_auto_sync_date,
                now=now,
            )
            if not decision.should_run:
                logger.debug(
                    "Scheduled sync skipped: job_key=%s reason=%s time=%s weekdays_only=%s",
                    job.job_key,
                    decision.reason,
                    daily_sync_time,
                    weekdays_only,
                )
                continue

            mark_job_auto_sync_attempted(db, job, now.date())
            _run_scheduled_job(db, settings, job.job_key)


def _run_scheduled_job(db, settings: Settings, job_key: str) -> None:
    if job_key == IBKR_FLEX_JOB_KEY:
        SyncRunner(SyncService(settings)).run(db, trigger=f"scheduled:{job_key}", skip_if_busy=True)
        return
    if job_key == NASDAQ_SYMBOL_SYNC_JOB_KEY:
        SymbolDirectorySyncService().sync_from_nasdaq(db)
        return
    logger.warning("Scheduled sync skipped: unsupported job_key=%s", job_key)
