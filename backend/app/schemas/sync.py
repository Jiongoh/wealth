from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class RawFlexReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    report_date: date | None
    query_id: str
    xml_path: str
    xml_sha256: str
    downloaded_at: datetime
    status: str
    error_message: str | None


class SyncRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_key: str
    started_at: datetime
    finished_at: datetime | None
    status: str
    duration_ms: int | None
    rows_total: int | None
    rows_inserted: int | None
    rows_updated: int | None
    rows_deleted: int | None
    artifact_path: str | None
    error_message: str | None
    metadata_json: dict | None
    created_at: datetime
    message: str | None
    report_date: date | None
    raw_flex_report_id: int | None


class SyncStatusResponse(BaseModel):
    latest_run: SyncRunResponse | None
    latest_raw_flex_report: RawFlexReportResponse | None


class SyncJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_key: str
    display_name: str | None
    enabled: bool
    use_shared_schedule: bool
    schedule_type: str | None
    daily_sync_time: str | None
    weekdays_only: bool | None
    cron_expression: str | None
    timezone: str | None
    last_auto_sync_date: date | None
    last_run_at: datetime | None
    next_run_at: datetime | None
    status: str | None
    created_at: datetime
    updated_at: datetime


class SyncScheduleUpdate(BaseModel):
    daily_sync_time: str
    timezone_name: str | None = None
    weekdays_only: bool


class SyncJobScheduleUpdate(BaseModel):
    enabled: bool | None = None
    use_shared_schedule: bool
    daily_sync_time: str | None = None
    timezone: str | None = None
    weekdays_only: bool | None = None


class SyncScheduleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    daily_sync_time: str
    timezone_name: str
    weekdays_only: bool
    last_auto_sync_date: date | None
    updated_at: datetime
