"""Add per-job sync schedule settings.

Revision ID: 20260605_0010
Revises: 20260605_0009
Create Date: 2026-06-05
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260605_0010"
down_revision: str | Sequence[str] | None = "20260605_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sync_jobs",
        sa.Column("use_shared_schedule", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column("sync_jobs", sa.Column("daily_sync_time", sa.String(length=5), nullable=True))
    op.add_column("sync_jobs", sa.Column("weekdays_only", sa.Boolean(), nullable=True))
    op.add_column("sync_jobs", sa.Column("last_auto_sync_date", sa.Date(), nullable=True))

    op.execute(
        """
        UPDATE sync_jobs
        SET use_shared_schedule = TRUE,
            schedule_type = COALESCE(schedule_type, 'daily')
        WHERE job_key IN ('ibkr_flex_sync', 'nasdaq_symbol_sync')
        """
    )


def downgrade() -> None:
    op.drop_column("sync_jobs", "last_auto_sync_date")
    op.drop_column("sync_jobs", "weekdays_only")
    op.drop_column("sync_jobs", "daily_sync_time")
    op.drop_column("sync_jobs", "use_shared_schedule")
