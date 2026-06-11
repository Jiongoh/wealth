"""Create sync schedule settings.

Revision ID: 20260601_0004
Revises: 20260528_0003
Create Date: 2026-06-01
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260601_0004"
down_revision: str | Sequence[str] | None = "20260528_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sync_runs", sa.Column("report_date", sa.Date(), nullable=True))
    op.execute(
        """
        UPDATE sync_runs
        SET report_date = raw_flex_reports.report_date
        FROM raw_flex_reports
        WHERE sync_runs.raw_flex_report_id = raw_flex_reports.id
        """
    )
    op.create_table(
        "sync_schedule",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("daily_sync_time", sa.String(length=5), nullable=False),
        sa.Column("timezone_name", sa.String(length=128), nullable=False),
        sa.Column("weekdays_only", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_auto_sync_date", sa.Date(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        """
        INSERT INTO sync_schedule (id, daily_sync_time, timezone_name, weekdays_only, updated_at)
        VALUES (1, '08:30', 'Host local time', false, CURRENT_TIMESTAMP)
        """
    )


def downgrade() -> None:
    op.drop_table("sync_schedule")
    op.drop_column("sync_runs", "report_date")
