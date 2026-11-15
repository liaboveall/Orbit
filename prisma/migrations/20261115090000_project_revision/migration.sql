-- Per-project change counter for cheap change detection (GET /my/pulse).
-- Bumped in the same statement that appends the activity row, i.e. inside the project lock,
-- so it is strictly monotonic in commit order. ActivityLog.createdAt is the transaction start
-- time and is not: a writer that queued on the lock commits later with an older timestamp.
-- Schema-only change: existing rows start at 0; no data is rewritten (constant default).
ALTER TABLE "Project" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Project" ADD CONSTRAINT "Project_revision_non_negative_check" CHECK ("revision" >= 0);
