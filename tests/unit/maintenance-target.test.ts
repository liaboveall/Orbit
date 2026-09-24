import { describe, expect, it } from "vitest";
import { maintenanceIntent } from "../../scripts/lib/maintenance-target";

const local = { APP_ENV: "test", DATABASE_URL: "postgresql://u:secret@localhost:5432/orbit_test?schema=public",
  STORAGE_ENDPOINT: "http://localhost:9000", STORAGE_BUCKET: "orbit-test", STORAGE_REGION: "us-east-1" };
describe("maintenance preflight", () => {
  it("binds invitation execution to its database, environment and scope without requiring storage", () => {
    const databaseOnly = { APP_ENV: "test", DATABASE_URL: local.DATABASE_URL };
    const preview = maintenanceIntent("invitation-tokens", [], databaseOnly);
    expect(preview.execute).toBe(false);
    expect(maintenanceIntent("invitation-tokens", ["--execute", `--target=${preview.target}`], databaseOnly).execute).toBe(true);
    for (const args of [["--apply", "--database=orbit_test"], ["--execute"], ["--execute", `--target=${preview.target}`]]) {
      const changed = args.length === 2 && args[0] === "--execute" ? { ...databaseOnly, DATABASE_URL: local.DATABASE_URL.replace(":5432", ":5433") } : databaseOnly;
      expect(() => maintenanceIntent("invitation-tokens", args, changed)).toThrow();
    }
    expect(() => maintenanceIntent("invitation-inspect", ["--execute", `--target=${preview.target}`], databaseOnly)).toThrow();
  });
  it("defaults to preview and requires a matching scoped target before execution", () => {
    const preview = maintenanceIntent("all", [], local);
    expect(preview.execute).toBe(false);
    expect(JSON.stringify(preview)).not.toContain("secret");
    expect(() => maintenanceIntent("all", ["--execute"], local)).toThrow();
    expect(maintenanceIntent("all", ["--execute", `--target=${preview.target}`], local).execute).toBe(true);
    expect(() => maintenanceIntent("attachments", ["--execute", `--target=${preview.target}`], local)).toThrow();
    expect(() => maintenanceIntent("all", ["--execute", `--target=${preview.target}`], { ...local, STORAGE_REGION: "other" })).toThrow();
  });
  it("rejects implicit environments, remote local-mode resources and target overrides", () => {
    for (const overrides of [{ APP_ENV: undefined }, { DATABASE_URL: "postgresql://u:p@remote/orbit_test" },
      { DATABASE_URL: local.DATABASE_URL + "&host=remote" }, { STORAGE_BUCKET: "real-files" },
      { DATABASE_URL: "postgresql://u:p@localhost/orbit_prod" }])
      expect(() => maintenanceIntent("all", [], { ...local, ...overrides })).toThrow();
    expect(() => maintenanceIntent("all", ["--execute", "--dry-run"], local)).toThrow();
    expect(() => maintenanceIntent("all", ["--execut"], local)).toThrow();
  });
  it("supports explicitly acknowledged production maintenance without allowing test cleanup there", () => {
    const production = { ...local, APP_ENV: "production", DATABASE_URL: "postgresql://u:p@db/orbit", STORAGE_ENDPOINT: "https://s3.example.com", STORAGE_BUCKET: "private" };
    const { target } = maintenanceIntent("all", [], production);
    expect(maintenanceIntent("all", ["--execute"], { ...production, ORBIT_MAINTENANCE_TARGET: target }).execute).toBe(true);
    expect(() => maintenanceIntent("all", ["--execute"], { ...production, DATABASE_URL: "postgresql://u:p@other/orbit", ORBIT_MAINTENANCE_TARGET: target })).toThrow();
  });
});
