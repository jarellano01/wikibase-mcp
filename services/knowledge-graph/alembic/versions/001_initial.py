"""Initial knowledge graph schema tables.

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
    op.execute("CREATE SCHEMA IF NOT EXISTS knowledge_graph")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "knowledge_base",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("category", sa.Text, nullable=False),
        sa.Column("key", sa.Text, nullable=False, unique=True),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("embedding", sa.LargeBinary),  # vector(768) — raw SQL below
        sa.Column("scope", sa.Text, nullable=False, server_default="global"),
        sa.Column("tags", sa.ARRAY(sa.Text), server_default=sa.text("'{}'::text[]")),
        sa.Column("source", sa.Text, nullable=False, server_default="manual"),
        sa.Column("source_file", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema="knowledge_graph",
    )
    # Replace the LargeBinary placeholder with actual vector type
    op.execute("ALTER TABLE knowledge_graph.knowledge_base ALTER COLUMN embedding TYPE vector(768) USING embedding::vector(768)")
    op.create_index("idx_kb_scope", "knowledge_base", ["scope"], schema="knowledge_graph")
    op.execute("CREATE INDEX idx_kb_tags ON knowledge_graph.knowledge_base USING gin(tags)")

    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("scope", sa.Text, nullable=False, server_default="global"),
        sa.Column("user_name", sa.Text),
        sa.Column("status", sa.Text, nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema="knowledge_graph",
    )

    op.create_table(
        "session_entries",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("session_id", sa.Integer, sa.ForeignKey("knowledge_graph.sessions.id"), nullable=False),
        sa.Column("sequence", sa.Integer, nullable=False),
        sa.Column("entry_type", sa.Text, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("metadata", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("embedding", sa.LargeBinary),  # vector(768) — raw SQL below
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema="knowledge_graph",
    )
    op.execute("ALTER TABLE knowledge_graph.session_entries ALTER COLUMN embedding TYPE vector(768) USING embedding::vector(768)")
    op.create_unique_constraint("uq_session_sequence", "session_entries", ["session_id", "sequence"], schema="knowledge_graph")

    op.create_table(
        "knowledge_candidates",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("category", sa.Text, nullable=False),
        sa.Column("key", sa.Text, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("embedding", sa.LargeBinary),  # vector(768)
        sa.Column("rationale", sa.Text),
        sa.Column("scope", sa.Text, nullable=False, server_default="global"),
        sa.Column("tags", sa.ARRAY(sa.Text), server_default=sa.text("'{}'::text[]")),
        sa.Column("session_id", sa.Integer, sa.ForeignKey("knowledge_graph.sessions.id")),
        sa.Column("status", sa.Text, nullable=False, server_default="pending"),
        sa.Column("reviewed_by", sa.Text),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema="knowledge_graph",
    )
    op.execute("ALTER TABLE knowledge_graph.knowledge_candidates ALTER COLUMN embedding TYPE vector(768) USING embedding::vector(768)")


def downgrade() -> None:
    op.drop_table("knowledge_candidates", schema="knowledge_graph")
    op.drop_table("session_entries", schema="knowledge_graph")
    op.drop_table("sessions", schema="knowledge_graph")
    op.drop_table("knowledge_base", schema="knowledge_graph")
