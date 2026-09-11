-- The composite FK already enforces task existence and project ownership.
-- Remove only the redundant single-column FK; keep the stronger invariant.
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_taskId_fkey";
