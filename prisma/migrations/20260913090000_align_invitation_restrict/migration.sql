-- Preserve accepted invitation audit identity, consistent with the paired acceptance CHECK.
-- Schema-only change: no user/attachment rows are deleted or rewritten.
ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_acceptedById_fkey";
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedById_fkey"
  FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The separate reserved/used nonnegative checks added in M5 remain in force.
ALTER TABLE "Project" DROP CONSTRAINT "Project_bytes_non_negative_check";
