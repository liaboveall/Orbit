CREATE TABLE "RateLimitBucket" (
  "keyHash" CHAR(64) PRIMARY KEY,
  "windowStart" TIMESTAMPTZ(3) NOT NULL,
  "count" INTEGER NOT NULL CHECK ("count" >= 0),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
CREATE TABLE "UploadLease" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "keyHash" CHAR(64) NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX "UploadLease_keyHash_startedAt_idx" ON "UploadLease"("keyHash", "startedAt");
CREATE INDEX "UploadLease_expiresAt_idx" ON "UploadLease"("expiresAt");
