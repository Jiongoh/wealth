"""Add US symbols and generic sync jobs.

Revision ID: 20260605_0008
Revises: 20260602_0007
Create Date: 2026-06-05
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260605_0008"
down_revision: str | Sequence[str] | None = "20260602_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sync_jobs",
        sa.Column("job_key", sa.String(length=80), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("schedule_type", sa.String(length=50), nullable=True),
        sa.Column("cron_expression", sa.String(length=120), nullable=True),
        sa.Column("timezone", sa.String(length=128), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("job_key"),
    )
    op.bulk_insert(
        sa.table(
            "sync_jobs",
            sa.column("job_key", sa.String()),
            sa.column("display_name", sa.String()),
            sa.column("enabled", sa.Boolean()),
            sa.column("schedule_type", sa.String()),
            sa.column("timezone", sa.String()),
            sa.column("created_at", sa.DateTime(timezone=True)),
            sa.column("updated_at", sa.DateTime(timezone=True)),
        ),
        [
            {
                "job_key": "ibkr_flex_sync",
                "display_name": "IBKR Flex Sync",
                "enabled": True,
                "schedule_type": "daily",
                "timezone": "Host local time",
            },
            {
                "job_key": "nasdaq_symbol_sync",
                "display_name": "Nasdaq Symbol Directory Sync",
                "enabled": True,
                "schedule_type": None,
                "timezone": None,
            },
        ],
    )

    op.create_table(
        "us_symbols",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("exchange", sa.String(length=80), nullable=True),
        sa.Column("market_category", sa.String(length=10), nullable=True),
        sa.Column("test_issue", sa.String(length=10), nullable=True),
        sa.Column("financial_status", sa.String(length=10), nullable=True),
        sa.Column("round_lot_size", sa.Integer(), nullable=True),
        sa.Column("is_etf", sa.Boolean(), nullable=True),
        sa.Column("is_nextshares", sa.Boolean(), nullable=True),
        sa.Column("source_file", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("symbol", name="uq_us_symbols_symbol"),
    )
    op.create_index("ix_us_symbols_symbol", "us_symbols", ["symbol"])
    op.create_index("ix_us_symbols_name", "us_symbols", ["name"])

    op.add_column(
        "sync_runs",
        sa.Column(
            "job_key",
            sa.String(length=80),
            nullable=False,
            server_default="ibkr_flex_sync",
        ),
    )
    op.add_column("sync_runs", sa.Column("duration_ms", sa.Integer(), nullable=True))
    op.add_column("sync_runs", sa.Column("rows_total", sa.Integer(), nullable=True))
    op.add_column("sync_runs", sa.Column("rows_inserted", sa.Integer(), nullable=True))
    op.add_column("sync_runs", sa.Column("rows_updated", sa.Integer(), nullable=True))
    op.add_column("sync_runs", sa.Column("rows_deleted", sa.Integer(), nullable=True))
    op.add_column("sync_runs", sa.Column("artifact_path", sa.Text(), nullable=True))
    op.add_column("sync_runs", sa.Column("error_message", sa.Text(), nullable=True))
    op.add_column("sync_runs", sa.Column("metadata_json", sa.JSON(), nullable=True))
    op.create_index("ix_sync_runs_job_key", "sync_runs", ["job_key"])
    op.create_foreign_key(
        "fk_sync_runs_job_key_sync_jobs",
        "sync_runs",
        "sync_jobs",
        ["job_key"],
        ["job_key"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_sync_runs_job_key_sync_jobs", "sync_runs", type_="foreignkey")
    op.drop_index("ix_sync_runs_job_key", table_name="sync_runs")
    op.drop_column("sync_runs", "metadata_json")
    op.drop_column("sync_runs", "error_message")
    op.drop_column("sync_runs", "artifact_path")
    op.drop_column("sync_runs", "rows_deleted")
    op.drop_column("sync_runs", "rows_updated")
    op.drop_column("sync_runs", "rows_inserted")
    op.drop_column("sync_runs", "rows_total")
    op.drop_column("sync_runs", "duration_ms")
    op.drop_column("sync_runs", "job_key")

    op.drop_index("ix_us_symbols_name", table_name="us_symbols")
    op.drop_index("ix_us_symbols_symbol", table_name="us_symbols")
    op.drop_table("us_symbols")
    op.drop_table("sync_jobs")
