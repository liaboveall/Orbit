import dotenv from "dotenv";
import setup from "../e2e/support/isolation-setup";

// Run in the coordinator, before workers replace DATABASE_URL with the test URL.
export default async function globalSetup() {
  dotenv.config({ path: [".env.local", ".env"], quiet: true });
  return setup();
}
