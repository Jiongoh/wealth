import logging
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.sync import get_app_settings, get_sync_service
from app.core.config import Settings
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models import (
    CashReport,
    LotAnalysisDaily,
    NavDaily,
    PositionLot,
    RawFlexReport,
    SyncJob,
    SyncRun,
    Trade,
)
from app.services.ibkr_client import _resolve_endpoint_urls
from app.services.sync_runner import sync_execution_lock
from app.services.sync_service import SyncService


class StaticDownloader:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def download_xml(self) -> bytes:
        return self.content


class FailingDownloader:
    def __init__(self, message: str) -> None:
        self.message = message

    def download_xml(self) -> bytes:
        raise RuntimeError(self.message)


def make_settings(raw_xml_dir: str, **overrides: str) -> Settings:
    values = {
        "app_name": "ibkr-sync-test",
        "app_version": "test",
        "log_level": "INFO",
        "cors_origins": [],
        "database_url": "sqlite://",
        "raw_xml_dir": raw_xml_dir,
        "app_timezone": "UTC",
        "ibkr_token": "unused-for-injected-mock",
        "ibkr_query_id": "mock-query-id",
        "ibkr_flex_url": "https://example.invalid/flex",
        "ibkr_flex_version": "3",
        "ibkr_request_timeout_seconds": 1.0,
        "ibkr_statement_poll_seconds": 0.0,
        "ibkr_statement_poll_attempts": 1,
        "sync_cron_hour": 0,
        "sync_cron_minute": 0,
    }
    values.update(overrides)
    return Settings(**values)


class SyncApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )

    def tearDown(self) -> None:
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _client(self, service: SyncService) -> TestClient:
        app = create_app(service.settings)

        def database_override():
            with self.session_factory() as session:
                yield session

        app.dependency_overrides[get_db] = database_override
        app.dependency_overrides[get_sync_service] = lambda: service
        app.dependency_overrides[get_app_settings] = lambda: service.settings
        return TestClient(app)

    def test_mock_sync_archives_xml_and_deduplicates_it(self) -> None:
        settings = make_settings(self.temp_dir.name)
        xml = (Path(__file__).parent / "fixtures" / "minimal_flex_statement.xml").read_bytes()
        client = self._client(SyncService(settings, downloader=StaticDownloader(xml)))

        first = client.post("/api/sync/run")
        second = client.post("/api/sync/run")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["status"], "success")
        self.assertEqual(first.json()["report_date"], "2026-01-31")
        self.assertEqual(second.json()["status"], "duplicate")
        status = client.get("/api/sync/status")
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["latest_run"]["report_date"], "2026-01-31")
        self.assertEqual(
            status.json()["latest_raw_flex_report"]["xml_sha256"],
            sha256(xml).hexdigest(),
        )
        with self.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count(RawFlexReport.id))), 1)
            self.assertEqual(session.scalar(select(func.count(SyncRun.id))), 2)
            self.assertEqual(session.scalar(select(func.count(PositionLot.id))), 1)
            self.assertEqual(session.scalar(select(func.count(Trade.id))), 3)
            self.assertEqual(session.scalar(select(func.count(CashReport.id))), 1)
            self.assertEqual(session.scalar(select(func.count(NavDaily.id))), 1)
            self.assertEqual(session.scalar(select(func.count(LotAnalysisDaily.id))), 1)
            report = session.scalar(select(RawFlexReport))
            self.assertEqual(report.status, "parsed")
            latest_run = session.scalar(select(SyncRun).order_by(SyncRun.id.desc()))
            self.assertEqual(latest_run.report_date, report.report_date)
        self.assertEqual(len(list(Path(self.temp_dir.name).glob("*.xml"))), 1)

    def test_sync_schedule_can_be_read_and_updated(self) -> None:
        settings = make_settings(self.temp_dir.name, app_timezone="UTC")
        client = self._client(SyncService(settings))

        initial = client.get("/api/sync/schedule")
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(initial.json()["daily_sync_time"], "00:00")
        self.assertEqual(initial.json()["weekdays_only"], False)

        updated = client.put(
            "/api/sync/schedule",
            json={"daily_sync_time": "09:30", "timezone_name": "Asia/Taipei", "weekdays_only": True},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["daily_sync_time"], "09:30")
        self.assertEqual(updated.json()["timezone_name"], "Asia/Taipei")
        self.assertEqual(updated.json()["weekdays_only"], True)

        reloaded = client.get("/api/sync/schedule")
        self.assertEqual(reloaded.json()["daily_sync_time"], "09:30")
        self.assertEqual(reloaded.json()["timezone_name"], "Asia/Taipei")
        self.assertEqual(reloaded.json()["weekdays_only"], True)

    def test_sync_job_schedule_can_use_shared_or_custom_schedule(self) -> None:
        settings = make_settings(self.temp_dir.name, app_timezone="UTC")
        client = self._client(SyncService(settings))
        with self.session_factory() as session:
            session.add_all(
                [
                    SyncJob(
                        job_key="ibkr_flex_sync",
                        display_name="IBKR Flex Sync",
                        enabled=True,
                        use_shared_schedule=True,
                        schedule_type="daily",
                    ),
                    SyncJob(
                        job_key="nasdaq_symbol_sync",
                        display_name="Nasdaq Symbol Directory Sync",
                        enabled=True,
                        use_shared_schedule=True,
                        schedule_type="daily",
                    ),
                ]
            )
            session.commit()

        shared = client.put(
            "/api/sync/jobs/nasdaq_symbol_sync/schedule",
            json={"enabled": True, "use_shared_schedule": True},
        )
        self.assertEqual(shared.status_code, 200)
        self.assertEqual(shared.json()["use_shared_schedule"], True)
        self.assertIsNone(shared.json()["daily_sync_time"])
        self.assertIsNone(shared.json()["timezone"])

        custom = client.put(
            "/api/sync/jobs/nasdaq_symbol_sync/schedule",
            json={
                "enabled": True,
                "use_shared_schedule": False,
                "daily_sync_time": "08:00",
                "timezone": "Asia/Taipei",
                "weekdays_only": False,
            },
        )
        self.assertEqual(custom.status_code, 200)
        self.assertEqual(custom.json()["use_shared_schedule"], False)
        self.assertEqual(custom.json()["daily_sync_time"], "08:00")
        self.assertEqual(custom.json()["timezone"], "Asia/Taipei")
        self.assertEqual(custom.json()["weekdays_only"], False)

    def test_sync_schedule_rejects_invalid_time(self) -> None:
        settings = make_settings(self.temp_dir.name)
        client = self._client(SyncService(settings))

        response = client.put(
            "/api/sync/schedule",
            json={"daily_sync_time": "25:99", "weekdays_only": False},
        )

        self.assertEqual(response.status_code, 422)

    def test_invalid_xml_marks_report_and_sync_failed_without_business_rows(self) -> None:
        settings = make_settings(self.temp_dir.name)
        client = self._client(
            SyncService(settings, downloader=StaticDownloader(b"<FlexQueryResponse>"))
        )

        response = client.post("/api/sync/run")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        with self.session_factory() as session:
            report = session.scalar(select(RawFlexReport))
            self.assertEqual(report.status, "failed")
            self.assertIn("Flex XML ingestion failed", report.error_message)
            self.assertEqual(session.scalar(select(func.count(PositionLot.id))), 0)

    def test_real_client_reports_missing_configuration_without_network_call(self) -> None:
        settings = make_settings(
            self.temp_dir.name,
            ibkr_token="",
            ibkr_query_id="",
            ibkr_flex_url="",
        )
        client = self._client(SyncService(settings))

        health = client.get("/api/health")
        response = client.post("/api/sync/run")

        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json(), {"status": "ok"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        self.assertEqual(
            response.json()["message"],
            "Missing IBKR configuration: IBKR_TOKEN, IBKR_QUERY_ID, IBKR_FLEX_URL",
        )

    def test_sync_error_response_and_log_redact_token(self) -> None:
        token = "very-secret-real-token"
        settings = make_settings(self.temp_dir.name, ibkr_token=token)
        service = SyncService(
            settings, downloader=FailingDownloader(f"request rejected for {token}")
        )
        client = self._client(service)

        with self.assertLogs("app.services.sync_service", level=logging.ERROR) as logs:
            response = client.post("/api/sync/run")

        self.assertNotIn(token, response.json()["message"])
        self.assertNotIn(token, "\n".join(logs.output))
        self.assertIn("[REDACTED]", response.json()["message"])

    def test_manual_sync_returns_busy_when_a_sync_is_already_running(self) -> None:
        settings = make_settings(self.temp_dir.name)
        client = self._client(
            SyncService(settings, downloader=StaticDownloader(b"<not-requested />"))
        )
        self.assertTrue(sync_execution_lock.acquire(blocking=False))
        try:
            response = client.post("/api/sync/run")
        finally:
            sync_execution_lock.release()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json(),
            {"error": {"message": "A synchronization run is already in progress"}},
        )
        with self.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count(SyncRun.id))), 0)


class IbkrEndpointTest(unittest.TestCase):
    def test_resolves_slash_endpoint_url(self) -> None:
        self.assertEqual(
            _resolve_endpoint_urls("https://example.invalid/FlexWebService/SendRequest"),
            (
                "https://example.invalid/FlexWebService/SendRequest",
                "https://example.invalid/FlexWebService/GetStatement",
            ),
        )

    def test_resolves_servlet_endpoint_url(self) -> None:
        self.assertEqual(
            _resolve_endpoint_urls(
                "https://example.invalid/Universal/servlet/FlexStatementService.SendRequest"
            ),
            (
                "https://example.invalid/Universal/servlet/FlexStatementService.SendRequest",
                "https://example.invalid/Universal/servlet/FlexStatementService.GetStatement",
            ),
        )


if __name__ == "__main__":
    unittest.main()
