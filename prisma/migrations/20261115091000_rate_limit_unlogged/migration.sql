-- Rate-limit counters are disposable: losing them in a crash only restarts the current window.
-- UNLOGGED skips WAL for the per-request upsert, so a read no longer waits for a WAL flush.
-- PostgreSQL truncates unlogged tables after an unclean shutdown; pg_dump still includes them.
-- fillfactor leaves room for HOT updates of the counter (no indexed column changes in a window).
-- UploadLease stays logged: it is written once per upload and bounds concurrent transfers.
ALTER TABLE "RateLimitBucket" SET UNLOGGED;
ALTER TABLE "RateLimitBucket" SET (fillfactor = 50);
