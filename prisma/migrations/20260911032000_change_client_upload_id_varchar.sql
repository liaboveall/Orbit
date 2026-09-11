-- Migration: Change clientUploadId from Uuid to VarChar(64)
-- This migration is ONLY applied to orbit_test database, NOT orbit_dev

-- Step 1: Alter the column type for clientUploadId in Attachment table
ALTER TABLE "Attachment" 
  ALTER COLUMN "clientUploadId" TYPE VARCHAR(64) 
  USING "clientUploadId"::VARCHAR(64);

-- Step 2: Drop the existing unique constraint (if exists) and recreate with different type behavior
-- Note: UUID uniqueness semantics are the same as VarChar(64) for our use case,
-- so we keep the same unique index without modification

-- Step 3: Add a comment to document this change
COMMENT ON COLUMN "Attachment"."clientUploadId" IS 'Changed from Uuid to VarChar(64) per P0-3 security fix';
