/* Test-process preload only. No route, request parameter or production import.
 * Inject a rejected pg overview query for one explicitly registered fixture. */
import fs from "node:fs";
import pg from "pg";
const controlFile = process.env.ORBIT_TEST_FAULT_FILE;
if (controlFile) {
  const url = new URL(process.env.DATABASE_URL);
  if (process.env.APP_ENV !== "test" || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL ||
      !["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname)) {
    throw new Error("Render fault preload requires a verified local test database");
  }
  const query = pg.Client.prototype.query;
  pg.Client.prototype.query = function (...args) {
    const config = args[0];
    const sql = typeof config === "string" ? config : config?.text;
    const values = typeof config === "string" ? args[1] : config?.values;
    if (typeof sql === "string" && sql.includes('AS "totalOpen"') && Array.isArray(values) && fs.existsSync(controlFile)) {
      const control = JSON.parse(fs.readFileSync(controlFile, "utf8"));
      if (typeof control.userId === "string" && values.includes(control.userId)) {
        fs.writeFileSync(controlFile, JSON.stringify({ ...control, hits: (control.hits ?? 0) + 1 }));
        const error = new Error("Synthetic workbench render failure");
        const callback = args[args.length - 1];
        if (typeof callback === "function") { queueMicrotask(() => callback(error)); return; }
        return Promise.reject(error);
      }
    }
    return query.apply(this, args);
  };
}
