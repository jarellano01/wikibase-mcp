"""Initial reporting schema tables.

Revision ID: 001
Revises:
Create Date: 2026-03-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS reporting")

    op.create_table(
        "staged_uploads",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("file_name", sa.Text, nullable=False),
        sa.Column("table_name", sa.Text, nullable=False),
        sa.Column("columns", JSONB, nullable=False),
        sa.Column("row_count", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), server_default=sa.text("NOW() + INTERVAL '24 hours'")),
        schema="reporting",
    )

    op.create_table(
        "report_history",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("sql_queries", JSONB, server_default="'[]'"),
        sa.Column("output", sa.Text),
        sa.Column("tags", sa.ARRAY(sa.Text), server_default="'{}'"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema="reporting",
    )


def downgrade() -> None:
    op.drop_table("report_history", schema="reporting")
    op.drop_table("staged_uploads", schema="reporting")
