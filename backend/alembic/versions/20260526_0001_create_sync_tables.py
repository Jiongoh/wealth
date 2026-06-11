"""Create raw Flex report and sync run tables.

Revision ID: 20260526_0001
Revises:
Create Date: 2026-05-26
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260526_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "raw_flex_reports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("query_id", sa.String(length=255), nullable=False),
        sa.Column("xml_path", sa.String(length=1024), nullable=False),
        sa.Column("xml_sha256", sa.String(length=64), nullable=False),
        sa.Column("downloaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("xml_sha256"),
    )
    op.create_table(
        "sync_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("raw_flex_report_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["raw_flex_report_id"], ["raw_flex_reports.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("sync_runs")
    op.drop_table("raw_flex_reports")
