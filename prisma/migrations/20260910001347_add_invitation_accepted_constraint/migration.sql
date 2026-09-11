-- Migration to add CHECK constraint for Invitation.acceptedAt & acceptedById atomicity (R07 Security Fix)
-- Replaces previous failed migration with cleaner CHECK constraint instead of trigger
-- docs/04-DATA-MODEL.md §5, docs/01-PRODUCT-SPEC.md §5.3.2
-- 
-- Consistency rule: acceptedAt and acceptedById must be both NULL or both non-NULL
-- This prevents security bug where consumed invitations could be reused

-- Drop previous failed migration attempt if exists (idempotent cleanup)
DROP TRIGGER IF EXISTS trg_check_invitation_accepted_fields ON "Invitation";
DROP FUNCTION IF EXISTS check_invitation_accepted_fields() CASCADE;

-- Add CHECK constraint using ALTER TABLE - simpler than trigger, built into PostgreSQL schema layer
-- Automatically enforced on INSERT/UPDATE, no custom function maintenance needed
ALTER TABLE "Invitation" 
ADD CONSTRAINT checked_accepted_at_and_by_id
CHECK (
  ("acceptedAt" IS NULL AND "acceptedById" IS NULL) OR 
  ("acceptedAt" IS NOT NULL AND "acceptedById" IS NOT NULL)
);

-- Verify constraint was added successfully
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'checked_accepted_at_and_by_id';
