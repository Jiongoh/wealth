from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import SyncJob, SyncRun
from app.schemas.sync import (
    SyncJobResponse,
    SyncJobScheduleUpdate,
    SyncRunResponse,
    SyncScheduleResponse,
    SyncScheduleUpdate,
    SyncStatusResponse,
)
from app.services.sync_runner import SyncBusyError, SyncRunner
from app.services.sync_schedule import get_or_create_schedule, update_job_schedule, update_schedule
from app.services.sync_service import SyncService
from app.services.symbol_directory_sync import NASDAQ_SYMBOL_SYNC_JOB_KEY, SymbolDirectorySyncService

router = APIRouter(prefix="/sync", tags=["sync"])

MAX_SYNC_RUN_LIMIT = 50
IBKR_FLEX_JOB_KEY = "ibkr_flex_sync"


def get_sync_service() -> SyncService:
    return SyncService(get_settings())


def get_app_settings() -> Settings:
    return get_settings()


def get_sync_runner(service: SyncService = Depends(get_sync_service)) -> SyncRunner:
    return SyncRunner(service)


@router.post("/run", response_model=SyncRunResponse)
def run_sync(
    db: Session = Depends(get_db),
    runner: SyncRunner = Depends(get_sync_runner),
) -> SyncRunResponse:
    try:
        sync_run = runner.run(db, trigger="manual")
    except SyncBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if sync_run is None:
        raise RuntimeError("Manual synchronization unexpectedly skipped")
    return SyncRunResponse.model_validate(sync_run)


@router.get("/jobs", response_model=list[SyncJobResponse])
def list_sync_jobs(db: Session = Depends(get_db)) -> list[SyncJobResponse]:
    jobs = db.scalars(select(SyncJob).order_by(SyncJob.job_key.asc())).all()
    return [SyncJobResponse.model_validate(job) for job in jobs]


@router.get("/jobs/{job_key}/runs", response_model=list[SyncRunResponse])
def list_sync_job_runs(
    job_key: str,
    limit: int = 20,
    db: Session = Depends(get_db),
) -> list[SyncRunResponse]:
    _get_sync_job_or_404(db, job_key)
    safe_limit = max(1, min(limit, MAX_SYNC_RUN_LIMIT))
    runs = db.scalars(
        select(SyncRun)
        .where(SyncRun.job_key == job_key)
        .order_by(SyncRun.started_at.desc(), SyncRun.id.desc())
        .limit(safe_limit)
    ).all()
    return [SyncRunResponse.model_validate(run) for run in runs]


@router.post("/jobs/{job_key}/run", response_model=SyncRunResponse)
def run_sync_job(
    job_key: str,
    db: Session = Depends(get_db),
    runner: SyncRunner = Depends(get_sync_runner),
) -> SyncRunResponse:
    _get_sync_job_or_404(db, job_key)
    if job_key == NASDAQ_SYMBOL_SYNC_JOB_KEY:
        result = SymbolDirectorySyncService().sync_from_nasdaq(db)
        sync_run = db.get(SyncRun, result.sync_run_id)
        if sync_run is None:
            raise RuntimeError("Symbol directory synchronization run disappeared")
        return SyncRunResponse.model_validate(sync_run)

    if job_key != IBKR_FLEX_JOB_KEY:
        raise HTTPException(
            status_code=501,
            detail=f"Manual execution is not implemented for sync job: {job_key}",
        )

    try:
        sync_run = runner.run(db, trigger=f"manual:{job_key}")
    except SyncBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if sync_run is None:
        raise RuntimeError("Manual synchronization unexpectedly skipped")
    return SyncRunResponse.model_validate(sync_run)


@router.get("/status", response_model=SyncStatusResponse)
def get_sync_status(
    db: Session = Depends(get_db),
    service: SyncService = Depends(get_sync_service),
) -> SyncStatusResponse:
    latest_run, latest_report = service.get_latest_status(db)
    return SyncStatusResponse(
        latest_run=latest_run,
        latest_raw_flex_report=latest_report,
    )


@router.get("/schedule", response_model=SyncScheduleResponse)
def get_sync_schedule(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> SyncScheduleResponse:
    return SyncScheduleResponse.model_validate(get_or_create_schedule(db, settings))


@router.put("/schedule", response_model=SyncScheduleResponse)
def put_sync_schedule(
    payload: SyncScheduleUpdate,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> SyncScheduleResponse:
    try:
        schedule = update_schedule(
            db,
            settings,
            daily_sync_time=payload.daily_sync_time,
            timezone_name=payload.timezone_name,
            weekdays_only=payload.weekdays_only,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return SyncScheduleResponse.model_validate(schedule)


@router.put("/jobs/{job_key}/schedule", response_model=SyncJobResponse)
def put_sync_job_schedule(
    job_key: str,
    payload: SyncJobScheduleUpdate,
    db: Session = Depends(get_db),
) -> SyncJobResponse:
    job = _get_sync_job_or_404(db, job_key)
    try:
        updated = update_job_schedule(
            db,
            job,
            enabled=payload.enabled,
            use_shared_schedule=payload.use_shared_schedule,
            daily_sync_time=payload.daily_sync_time,
            timezone=payload.timezone,
            weekdays_only=payload.weekdays_only,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return SyncJobResponse.model_validate(updated)


def _get_sync_job_or_404(db: Session, job_key: str) -> SyncJob:
    job = db.get(SyncJob, job_key)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Sync job not found: {job_key}")
    return job
