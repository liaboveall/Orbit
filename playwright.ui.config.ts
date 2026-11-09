import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./tests/ui",
  reporter: "list",
  use: { ...base.use, screenshot: "only-on-failure" },
});
