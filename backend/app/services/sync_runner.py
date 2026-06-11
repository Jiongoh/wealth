import logging
from threading import Lock

from sqlalchemy.orm import Session

from app.models.sync_run import SyncRun
from app.services.sync_service import SyncService

logger = logging.getLogger(__name__)
sync_execution_lock = Lock()


class SyncBusyError(Exception):
    pass


class SyncRunner:
    def __init__(self, sync_service: SyncService) -> None:
        self.sync_service = sync_service

    def run(
        self, db: Session, *, trigger: str, skip_if_busy: bool = False
    ) -> SyncRun | None:
        if not sync_execution_lock.acquire(blocking=False):
            logger.info("IBKR Flex synchronization skipped: trigger=%s reason=busy", trigger)
            if skip_if_busy:
                return None
            raise SyncBusyError("A synchronization run is already in progress")

        logger.info("IBKR Flex synchronization started: trigger=%s", trigger)
        try:
            sync_run = self.sync_service.run(db)
            if sync_run.status == "failed":
                logger.error(
                    "IBKR Flex synchronization completed with failure:"
                    " trigger=%s sync_run_id=%s error=%s",
                    trigger,
                    sync_run.id,
                    sync_run.message,
                )
            else:
                logger.info(
                    "IBKR Flex synchronization completed:"
                    " trigger=%s sync_run_id=%s status=%s",
                    trigger,
                    sync_run.id,
                    sync_run.status,
                )
            return sync_run
        except Exception:
            logger.error("IBKR Flex synchronization aborted: trigger=%s", trigger)
            raise
        finally:
            sync_execution_lock.release()
