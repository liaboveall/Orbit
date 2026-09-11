-- Deletion semantics also apply to records created before the R06 fix.
-- Keep the idempotency key/hash and tombstone metadata, never deleted text.
UPDATE "IdempotencyRecord" r
SET "responseBody" = jsonb_set(
  jsonb_set(r."responseBody", '{body}', 'null'::jsonb),
  '{isDeleted}', 'true'::jsonb
)
FROM "Comment" c
WHERE r."resourceId" = c.id::text
  AND r."userId" = c."authorId"
  AND r.method = 'POST'
  AND c."deletedAt" IS NOT NULL
  AND r."responseBody"->>'body' IS NOT NULL;
