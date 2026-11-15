import "server-only";

/** How long a passed schema verification is trusted before the catalogs are read again. */
export const READINESS_VERIFY_INTERVAL_MS = 5 * 60_000;

/**
 * Readiness probe for an endpoint that is polled every few seconds (container health check,
 * uptime monitor). The schema can only change through a migration, so the full catalog
 * comparison runs when the process starts, after any failure, and then at most once per
 * interval. In between, each probe is a single cheap statement: a database outage is still
 * reported on the very next probe, without two catalog scans every 30 seconds.
 */
export function createReadinessProbe(
  verify: () => Promise<boolean>,
  ping: () => Promise<unknown>,
  now: () => number = Date.now,
  interval: number = READINESS_VERIFY_INTERVAL_MS,
): () => Promise<boolean> {
  let verifiedAt: number | null = null;
  return async () => {
    if (verifiedAt !== null && now() - verifiedAt < interval) {
      try {
        await ping();
        return true;
      } catch {
        // Unreachable database: verify the schema again once it is back.
        verifiedAt = null;
        return false;
      }
    }
    const ready = await verify();
    verifiedAt = ready ? now() : null;
    return ready;
  };
}
