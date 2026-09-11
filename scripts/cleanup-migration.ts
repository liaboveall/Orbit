/** Historical one-off repair retired after the seven migrations were verified.
 * Never delete Prisma migration history or drop database objects from this entrypoint.
 * Diagnose with `pnpm exec prisma migrate status`; prepare an explicit repair plan
 * for the specific failed migration before using Prisma migrate resolve.
 */
console.error("Historical migration repair is retired. Use prisma migrate status and a reviewed migration-specific recovery plan.");
process.exitCode = 1;
export {};
