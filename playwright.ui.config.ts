import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base, testDir: "./tests/ui", reporter: "list",
  use: {...base.use, screenshot: "only-on-failure"},
  webServer: {...base.webServer as object,
    command: process.env.E2E_SERVER_MODE === "dev" ? "pnpm exec prisma generate && node scripts/e2e-server.mjs" : "pnpm build && node scripts/e2e-server.mjs",
  },
});
