-- Clean up failed migration 20260910001346 from _prisma_migrations table
-- This migration was never successfully applied due to XOR syntax error

-- Remove the failed migration record from _prisma_migrations
DELETE FROM _prisma_migrations 
WHERE migration_name = '20260910001346_add_invitation_accepted_constraint';

-- Drop any trigger that might have been partially created
DROP TRIGGER IF EXISTS trg_check_invitation_accepted_fields ON "Invitation";
DROP FUNCTION IF EXISTS check_invitation_accepted_fields() CASCADE;

-- Verify cleanup
SELECT COUNT(*) as failed_migrations_count 
FROM _prisma_migrations 
WHERE migration_name = '20260910001346_add_invitation_accepted_constraint';
