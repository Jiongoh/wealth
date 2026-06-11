import unittest
from datetime import datetime

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models.sync_schedule import SyncSchedule
from app.services.sync_runner import SyncRunner, sync_execution_lock
from app.services.sync_schedule import should_run_now
from app.services.sync_scheduler import create_sync_scheduler


def make_settings() -> Settings:
    return Settings(
        app_name="ibkr-scheduler-test",
        app_version="test",
        log_level="INFO",
        cors_origins=[],
        database_url="sqlite://",
        raw_xml_dir="/tmp",
        app_timezone="Asia/Taipei",
        ibkr_token="",
        ibkr_query_id="",
        ibkr_flex_url="",
        ibkr_flex_version="3",
        ibkr_request_timeout_seconds=1.0,
        ibkr_statement_poll_seconds=0.0,
        ibkr_statement_poll_attempts=1,
        sync_cron_hour=7,
        sync_cron_minute=15,
    )


class FakeScheduler:
    def __init__(self) -> None:
        self.started = False
        self.shutdown_called = False
        self.shutdown_wait = True

    def start(self) -> None:
        self.started = True

    def shutdown(self, wait: bool = True) -> None:
        self.shutdown_called = True
        self.shutdown_wait = wait


class NeverCalledSyncService:
    called = False

    def run(self, _db):
        self.called = True
        raise AssertionError("Busy scheduled synchronization should have been skipped")


class SyncSchedulerTest(unittest.TestCase):
    def test_scheduler_configures_minute_checker_from_settings(self) -> None:
        scheduler = create_sync_scheduler(make_settings())
        scheduler.start(paused=True)
        try:
            job = scheduler.get_job("daily_ibkr_sync")
            self.assertIsNotNone(job)
            self.assertEqual(str(scheduler.timezone), "Asia/Taipei")
            self.assertIn("minute='*'", str(job.trigger))
        finally:
            scheduler.shutdown(wait=False)

    def test_application_lifespan_starts_and_stops_scheduler(self) -> None:
        scheduler = FakeScheduler()
        app = create_app(make_settings(), scheduler_factory=lambda _: scheduler)

        with TestClient(app) as client:
            self.assertEqual(client.get("/api/health").status_code, 200)
            self.assertTrue(scheduler.started)

        self.assertTrue(scheduler.shutdown_called)
        self.assertFalse(scheduler.shutdown_wait)

    def test_scheduled_sync_skips_when_another_run_holds_lock(self) -> None:
        service = NeverCalledSyncService()
        self.assertTrue(sync_execution_lock.acquire(blocking=False))
        try:
            result = SyncRunner(service).run(
                None, trigger="scheduled", skip_if_busy=True
            )
        finally:
            sync_execution_lock.release()

        self.assertIsNone(result)
        self.assertFalse(service.called)

    def test_schedule_decision_prevents_same_day_duplicate(self) -> None:
        schedule = SyncSchedule(
            daily_sync_time="09:30",
            timezone_name="UTC",
            weekdays_only=True,
            last_auto_sync_date=datetime(2026, 6, 1).date(),
        )

        decision = should_run_now(schedule, datetime(2026, 6, 1, 9, 30))

        self.assertFalse(decision.should_run)
        self.assertEqual(decision.reason, "already-ran-today")


if __name__ == "__main__":
    unittest.main()
