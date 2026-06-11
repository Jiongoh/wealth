from dataclasses import dataclass
from datetime import UTC, date, datetime
import os
import re
import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.sync_job import SyncJob
from app.models.sync_schedule import SyncSchedule

SCHEDULE_ID = 1
TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


@dataclass(frozen=True)
class ScheduleDecision:
    should_run: bool
    reason: str


def configured_timezone_name(settings: Settings) -> str:
    return os.getenv("TZ") or settings.app_timezone or time.tzname[0] or "Host local time"


def configured_timezone(settings: Settings) -> ZoneInfo:
    name = configured_timezone_name(settings)
    return timezone_from_name(name)


def timezone_from_name(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise RuntimeError(f"Invalid backend local timezone: {name}") from exc


def default_daily_sync_time(settings: Settings) -> str:
    return f"{settings.sync_cron_hour:02d}:{settings.sync_cron_minute:02d}"


def validate_daily_sync_time(value: str) -> str:
    normalized = value.strip()
    if not TIME_PATTERN.fullmatch(normalized):
        raise ValueError("daily_sync_time must use HH:mm format")
    return normalized


def get_or_create_schedule(db: Session, settings: Settings) -> SyncSchedule:
    schedule = db.get(SyncSchedule, SCHEDULE_ID)
    timezone_name = configured_timezone_name(settings)
    if schedule is None:
        schedule = SyncSchedule(
            id=SCHEDULE_ID,
            daily_sync_time=default_daily_sync_time(settings),
            timezone_name=timezone_name,
            weekdays_only=False,
        )
        db.add(schedule)
        db.commit()
        db.refresh(schedule)
        return schedule

    if schedule.timezone_name in {"", "Host local time"} and timezone_name:
        schedule.timezone_name = timezone_name
        db.commit()
        db.refresh(schedule)
    return schedule


def update_schedule(
    db: Session,
    settings: Settings,
    *,
    daily_sync_time: str,
    timezone_name: str | None = None,
    weekdays_only: bool,
) -> SyncSchedule:
    schedule = get_or_create_schedule(db, settings)
    schedule.daily_sync_time = validate_daily_sync_time(daily_sync_time)
    schedule.timezone_name = validate_timezone_name(timezone_name or configured_timezone_name(settings))
    schedule.weekdays_only = weekdays_only
    db.commit()
    db.refresh(schedule)
    return schedule


def validate_timezone_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("timezone must not be empty")
    try:
        timezone_from_name(normalized)
    except RuntimeError as exc:
        raise ValueError(str(exc)) from exc
    return normalized


def update_job_schedule(
    db: Session,
    job: SyncJob,
    *,
    enabled: bool | None,
    use_shared_schedule: bool,
    daily_sync_time: str | None,
    timezone: str | None,
    weekdays_only: bool | None,
) -> SyncJob:
    if enabled is not None:
        job.enabled = enabled
    job.use_shared_schedule = use_shared_schedule
    job.schedule_type = "daily"
    if use_shared_schedule:
        job.daily_sync_time = None
        job.timezone = None
        job.weekdays_only = None
        job.cron_expression = None
    else:
        if daily_sync_time is None:
            raise ValueError("daily_sync_time is required for custom schedule")
        if weekdays_only is None:
            raise ValueError("weekdays_only is required for custom schedule")
        if timezone is None:
            raise ValueError("timezone is required for custom schedule")
        job.daily_sync_time = validate_daily_sync_time(daily_sync_time)
        job.timezone = validate_timezone_name(timezone)
        job.weekdays_only = weekdays_only
        job.cron_expression = None
    db.commit()
    db.refresh(job)
    return job


def should_run_now(schedule: SyncSchedule, now: datetime) -> ScheduleDecision:
    return should_run_now_values(
        daily_sync_time=schedule.daily_sync_time,
        weekdays_only=schedule.weekdays_only,
        last_auto_sync_date=schedule.last_auto_sync_date,
        now=now,
    )


def should_run_now_values(
    *,
    daily_sync_time: str,
    weekdays_only: bool,
    last_auto_sync_date: date | None,
    now: datetime,
) -> ScheduleDecision:
    today = now.date()
    if last_auto_sync_date == today:
        return ScheduleDecision(False, "already-ran-today")
    if weekdays_only and now.weekday() >= 5:
        return ScheduleDecision(False, "weekend")
    if now.strftime("%H:%M") != daily_sync_time:
        return ScheduleDecision(False, "not-scheduled-minute")
    return ScheduleDecision(True, "due")


def mark_auto_sync_attempted(db: Session, schedule: SyncSchedule, run_date: date) -> None:
    schedule.last_auto_sync_date = run_date
    db.commit()


def mark_job_auto_sync_attempted(db: Session, job: SyncJob, run_date: date) -> None:
    job.last_auto_sync_date = run_date
    db.commit()
